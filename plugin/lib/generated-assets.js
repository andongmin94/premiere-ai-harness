(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./premiere-runtime.js"));
  else root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime) {
  "use strict";

  const ACTION_BATCH_SIZE = 32;
  const MAX_FOLDER_SCAN = 5000;
  const MAX_FOLDER_DEPTH = 24;

  async function createGeneratedBin(project, parentBin, name, ppro, options) {
    runtime.runTransaction(project, "Premiere AI Harness: 작업 빈 생성", [function () { return parentBin.createBinAction(name, false); }]);
    return runtime.poll(async function () {
      return castFolderByName(await parentBin.getItems(), name, ppro);
    }, options?.delay, `작업 빈 “${name}”을 찾지 못했습니다.`, options?.timeoutMs);
  }

  async function createSubclips(project, sourceClip, ranges, names, frameRateObject, ppro) {
    for (let offset = 0; offset < ranges.length; offset += ACTION_BATCH_SIZE) {
      const factories = [];
      for (let index = offset; index < Math.min(offset + ACTION_BATCH_SIZE, ranges.length); index += 1) {
        const range = ranges[index];
        factories.push(function () {
          const start = ppro.TickTime.createWithFrameAndFrameRate(range.startFrame, frameRateObject);
          const end = ppro.TickTime.createWithFrameAndFrameRate(range.endFrame, frameRateObject);
          return sourceClip.createSubClipAction(names[index], start, end, true, { takeVideo: true, takeAudio: true });
        });
      }
      runtime.runTransaction(project, "Premiere AI Harness: 유지 구간 서브클립 생성", factories);
    }
  }

  async function waitForNamedClips(folder, names, ppro, options) {
    const expected = new Set(names.map(String));
    return runtime.poll(async function () {
      const found = [];
      for (const item of await folder.getItems() || []) {
        if (!expected.has(String(item?.name || ""))) continue;
        try { found.push(ppro.ClipProjectItem.cast(item)); } catch (_) { /* not a clip */ }
      }
      if (found.length !== expected.size) return null;
      return found.sort((left, right) => names.indexOf(left.name) - names.indexOf(right.name));
    }, options?.delay, `생성된 서브클립 ${names.length}개를 확인하지 못했습니다.`, options?.timeoutMs);
  }

  async function moveItems(project, sourceFolder, targetFolder, items) {
    for (let offset = 0; offset < items.length; offset += ACTION_BATCH_SIZE) {
      const batch = items.slice(offset, offset + ACTION_BATCH_SIZE);
      runtime.runTransaction(project, "Premiere AI Harness: 생성 서브클립 정리", batch.map(function (item) {
        return function () { return sourceFolder.createMoveItemAction(item, targetFolder); };
      }));
    }
  }

  async function createAndActivateSequence(project, name, clips, targetBin) {
    const sequence = await project.createSequenceFromMedia(name, clips, targetBin);
    if (!sequence) throw new Error("새 시퀀스를 만들지 못했습니다.");
    if (await project.setActiveSequence(sequence) === false) throw new Error("새 시퀀스를 활성화하지 못했습니다.");
    const identity = runtime.sequenceIdentity(sequence);
    const exists = (await project.getSequences() || []).some((item) => runtime.sequenceIdentity(item) === identity);
    if (!exists) throw new Error("생성된 시퀀스를 프로젝트에서 다시 확인하지 못했습니다.");
    return sequence;
  }

  async function cleanupGenerated(resources, options) {
    const state = resources || {};
    const settings = options || {};
    const errors = [];
    let sequenceRemoved = !state.sequence;
    let binRemoved = !state.runBin;

    if (state.sequence) sequenceRemoved = await removeSequence(state.project, state.sequence, settings, errors);
    if (sequenceRemoved && settings.restoreActive) await restoreActiveSequence(state.project, settings.restoreActive, errors);
    if (sequenceRemoved && state.runBin) {
      const ownedBinRemoved = await removeOwnedBin(state, settings, errors);
      const looseSubclipsRemoved = await removeLooseSubclips(state, errors);
      binRemoved = ownedBinRemoved && looseSubclipsRemoved;
    } else if (sequenceRemoved && state.parentBin) {
      binRemoved = await removeLooseSubclips(state, errors);
    }

    const cleaned = sequenceRemoved && binRemoved && errors.length === 0;
    return Object.freeze({ cleaned, sequenceRemoved, binRemoved, errors: Object.freeze(errors.slice()) });
  }

  async function cleanupInternalArtifacts(ppro, options) {
    if (!ppro?.Project?.getActiveProject || !ppro?.FolderItem?.cast) throw new Error("Premiere UXP API를 불러오지 못했습니다.");
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("열린 Premiere 프로젝트가 없습니다.");
    if (typeof project.getRootItem !== "function") throw new Error("프로젝트 루트 조회 API를 사용할 수 없습니다.");
    const root = await project.getRootItem();
    if (!root) throw new Error("프로젝트 루트 빈을 찾지 못했습니다.");

    const errors = [];
    let removedSequences = 0;
    let removedBins = 0;
    for (const sequence of await project.getSequences() || []) {
      if (!runtime.isInternalName(sequence?.name)) continue;
      if (await removeSequence(project, sequence, options || {}, errors)) removedSequences += 1;
    }

    const folders = await findInternalFolders(root, ppro);
    for (const target of folders.sort((left, right) => right.depth - left.depth)) {
      if (await removeRecoveryFolder(project, target, errors)) removedBins += 1;
    }

    try {
      await runtime.poll(async function () {
        const staleSequence = (await project.getSequences() || []).some((item) => runtime.isInternalName(item?.name));
        const staleFolder = (await findInternalFolders(root, ppro)).length > 0;
        return !staleSequence && !staleFolder;
      }, options?.delay, "자체시험 흔적이 프로젝트에 남아 있습니다.", options?.timeoutMs);
    } catch (error) { errors.push(runtime.messageOf(error)); }

    if (errors.length) throw new Error(`자체시험 흔적 정리를 완료하지 못했습니다: ${errors.join(" / ")}`);
    return Object.freeze({ status: "PASS", removedSequences, removedBins });
  }

  async function removeSequence(project, sequence, options, errors) {
    const identity = runtime.sequenceIdentity(sequence);
    try {
      try { await project.closeSequence(sequence); } catch (_) { /* not open */ }
      if (await project.deleteSequence(sequence) === false) throw new Error(`시퀀스 삭제가 거부되었습니다: ${sequence?.name || identity}`);
      await runtime.poll(async function () {
        return !(await project.getSequences() || []).some((item) => runtime.sequenceIdentity(item) === identity);
      }, options?.delay, `시퀀스 삭제를 확인하지 못했습니다: ${sequence?.name || identity}`, options?.timeoutMs);
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function restoreActiveSequence(project, previous, errors) {
    try {
      const exists = (await project.getSequences() || []).some((item) => runtime.sequenceIdentity(item) === runtime.sequenceIdentity(previous));
      if (!exists) throw new Error("이전 활성 시퀀스가 더 이상 프로젝트에 없습니다.");
      if (await project.setActiveSequence(previous) === false) throw new Error("이전 활성 시퀀스를 복원하지 못했습니다.");
    } catch (error) { errors.push(runtime.messageOf(error)); }
  }

  async function removeOwnedBin(state, options, errors) {
    const expectedNames = new Set([...(state.subclipNames || []).map(String), ...(state.subclips || []).map((item) => String(item?.name || ""))]);
    try {
      const currentItems = await state.runBin.getItems() || [];
      const foreign = currentItems.filter((item) => !expectedNames.has(String(item?.name || "")));
      if (foreign.length) throw new Error("생성 빈에 플러그인이 만들지 않은 항목이 있어 자동 삭제하지 않았습니다.");
      if (currentItems.length) runtime.runTransaction(state.project, "Premiere AI Harness: 생성 서브클립 정리", currentItems.map(function (item) {
        return function () { return state.runBin.createRemoveItemAction(item); };
      }));
      runtime.runTransaction(state.project, "Premiere AI Harness: 작업 빈 정리", [function () { return state.parentBin.createRemoveItemAction(state.runBin); }]);
      await runtime.poll(async function () {
        return !(await state.parentBin.getItems() || []).some((item) => item === state.runBin || String(item?.name || "") === String(state.runBin?.name || ""));
      }, options?.delay, "생성 빈 삭제를 확인하지 못했습니다.", options?.timeoutMs);
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function removeLooseSubclips(state, errors) {
    try {
      const expected = new Set((state.subclipNames || []).map(String));
      const loose = (await state.parentBin.getItems() || []).filter((item) => expected.has(String(item?.name || "")));
      if (loose.length) runtime.runTransaction(state.project, "Premiere AI Harness: 생성 서브클립 정리", loose.map(function (item) {
        return function () { return state.parentBin.createRemoveItemAction(item); };
      }));
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function removeRecoveryFolder(project, target, errors) {
    try {
      const baseName = String(target.folder.name).replace(/_BIN$/i, "");
      const children = await target.folder.getItems() || [];
      const foreign = children.filter((item) => !String(item?.name || "").startsWith(baseName));
      if (foreign.length) throw new Error(`내부 시험 빈 “${target.folder.name}”에 사용자 항목이 있어 삭제하지 않았습니다.`);
      if (children.length) runtime.runTransaction(project, "Premiere AI Harness: 자체시험 자산 정리", children.map(function (item) {
        return function () { return target.folder.createRemoveItemAction(item); };
      }));
      runtime.runTransaction(project, "Premiere AI Harness: 자체시험 빈 정리", [function () { return target.parent.createRemoveItemAction(target.folder); }]);
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function findInternalFolders(root, ppro) {
    const found = [];
    const queue = [{ folder: root, depth: 0 }];
    let visited = 0;
    while (queue.length) {
      if (++visited > MAX_FOLDER_SCAN) throw new Error("프로젝트 빈 구조가 너무 커서 안전한 자체시험 정리를 중단했습니다.");
      const current = queue.shift();
      if (current.depth >= MAX_FOLDER_DEPTH) continue;
      for (const item of await current.folder.getItems() || []) {
        let folder = null;
        try { folder = ppro.FolderItem.cast(item); } catch (_) { folder = null; }
        if (!folder) continue;
        const target = { folder, parent: current.folder, depth: current.depth + 1 };
        if (runtime.isInternalName(folder.name)) found.push(target);
        queue.push(target);
      }
    }
    return found;
  }

  function castFolderByName(items, name, ppro) {
    for (const item of items || []) {
      if (String(item?.name || "") !== name) continue;
      try { return ppro.FolderItem.cast(item); } catch (_) { return null; }
    }
    return null;
  }

  return { createGeneratedBin, createSubclips, waitForNamedClips, moveItems, createAndActivateSequence, cleanupGenerated, cleanupInternalArtifacts, findInternalFolders };
});
