(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(require("./premiere-runtime.js"), require("./generated-assets.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI, root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime, assets) {
  "use strict";

  const MAX_FOLDER_SCAN = 5000;
  const MAX_FOLDER_DEPTH = 24;

  async function cleanupGenerated(resources, options) {
    const state = resources || {};
    const settings = options || {};
    const errors = [];
    state.sequence = state.sequence || await assets.findCreatedSequence(state.project, state.sequenceBaseline);
    state.runBin = state.runBin || await assets.findFolderByName(state.parentBin, state.binName, state.ppro);

    let sequenceRemoved = !state.sequence;
    if (state.sequence) sequenceRemoved = await removeSequence(state.project, state.sequence, settings, errors);
    if (sequenceRemoved && settings.restoreActive) await restoreActiveSequence(state.project, settings.restoreActive, errors);

    let binRemoved = !state.runBin;
    if (sequenceRemoved && state.runBin) binRemoved = await removeOwnedBin(state, settings, errors);
    const looseSubclipsRemoved = sequenceRemoved ? await removeLooseSubclips(state, errors) : false;
    if (!state.runBin && sequenceRemoved) binRemoved = looseSubclipsRemoved;

    await verifyCleanupState(state, settings, errors);
    const cleaned = sequenceRemoved && binRemoved && looseSubclipsRemoved && errors.length === 0;
    return Object.freeze({ cleaned, sequenceRemoved, binRemoved, errors: Object.freeze(errors.slice()) });
  }

  async function cleanupInternalArtifacts(ppro, options) {
    if (!ppro?.Project?.getActiveProject || !ppro?.FolderItem?.cast) throw new Error("Premiere UXP API를 불러오지 못했습니다.");
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("열린 Premiere 프로젝트가 없습니다.");
    const root = typeof project.getRootItem === "function" ? await project.getRootItem() : null;
    if (!root) throw new Error("프로젝트 루트 빈을 찾지 못했습니다.");

    const errors = [];
    let removedSequences = 0;
    let removedBins = 0;
    for (const sequence of await project.getSequences() || []) {
      if (runtime.isInternalName(sequence?.name) && await removeSequence(project, sequence, options || {}, errors)) removedSequences += 1;
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
    } catch (error) {
      errors.push(runtime.messageOf(error));
    }
    if (errors.length) throw new Error(`자체시험 흔적 정리를 완료하지 못했습니다: ${errors.join(" / ")}`);
    return Object.freeze({ status: "PASS", removedSequences, removedBins });
  }

  async function removeSequence(project, sequence, options, errors) {
    const identity = runtime.sequenceIdentity(sequence);
    try {
      try { await project.closeSequence(sequence); } catch (_) { /* sequence was not open */ }
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
      const identity = runtime.sequenceIdentity(previous);
      const exists = (await project.getSequences() || []).some((item) => runtime.sequenceIdentity(item) === identity);
      if (!exists) throw new Error("이전 활성 시퀀스가 더 이상 프로젝트에 없습니다.");
      if (await project.setActiveSequence(previous) === false) throw new Error("이전 활성 시퀀스를 복원하지 못했습니다.");
    } catch (error) {
      errors.push(runtime.messageOf(error));
    }
  }

  async function removeOwnedBin(state, options, errors) {
    const expectedNames = new Set((state.subclipNames || []).map(String));
    try {
      const currentItems = await state.runBin.getItems() || [];
      const foreign = currentItems.filter((item) => !expectedNames.has(String(item?.name || "")));
      if (foreign.length) throw new Error("생성 빈에 플러그인이 만들지 않은 항목이 있어 자동 삭제하지 않았습니다.");
      if (currentItems.length) {
        runtime.runTransaction(state.project, "Premiere AI Harness: 생성 서브클립 정리", currentItems.map(function (item) {
          return function () { return state.runBin.createRemoveItemAction(item); };
        }));
      }
      runtime.runTransaction(state.project, "Premiere AI Harness: 작업 빈 정리", [
        function () { return state.parentBin.createRemoveItemAction(state.runBin); },
      ]);
      await runtime.poll(async function () {
        return !(await state.parentBin.getItems() || []).some((item) => String(item?.name || "") === String(state.binName));
      }, options?.delay, "생성 빈 삭제를 확인하지 못했습니다.", options?.timeoutMs);
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function removeLooseSubclips(state, errors) {
    if (!state.parentBin) return true;
    try {
      const expected = new Set((state.subclipNames || []).map(String));
      const loose = (await state.parentBin.getItems() || []).filter((item) => expected.has(String(item?.name || "")));
      if (loose.length) {
        runtime.runTransaction(state.project, "Premiere AI Harness: 생성 서브클립 정리", loose.map(function (item) {
          return function () { return state.parentBin.createRemoveItemAction(item); };
        }));
      }
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function verifyCleanupState(state, options, errors) {
    try {
      await runtime.poll(async function () {
        const sequences = await state.project.getSequences() || [];
        const sequenceIdentity = runtime.sequenceIdentity(state.sequence);
        const sequenceExists = sequenceIdentity
          ? sequences.some((item) => runtime.sequenceIdentity(item) === sequenceIdentity)
          : sequences.some((item) => {
            const identity = runtime.sequenceIdentity(item);
            return identity && state.sequenceBaseline instanceof Set && !state.sequenceBaseline.has(identity);
          });
        const parentItems = state.parentBin ? await state.parentBin.getItems() || [] : [];
        const binExists = state.binName && parentItems.some((item) => String(item?.name || "") === state.binName);
        const expected = new Set((state.subclipNames || []).map(String));
        const looseExists = parentItems.some((item) => expected.has(String(item?.name || "")));
        return !sequenceExists && !binExists && !looseExists;
      }, options?.delay, "생성 자산 정리 결과를 확인하지 못했습니다.", options?.timeoutMs);
    } catch (error) {
      errors.push(runtime.messageOf(error));
    }
  }

  async function removeRecoveryFolder(project, target, errors) {
    try {
      const baseName = String(target.folder.name).replace(/_BIN$/i, "");
      const children = await target.folder.getItems() || [];
      const foreign = children.filter((item) => !String(item?.name || "").startsWith(`${baseName}_`));
      if (foreign.length) throw new Error(`내부 시험 빈 “${target.folder.name}”에 사용자 항목이 있어 삭제하지 않았습니다.`);
      if (children.length) {
        runtime.runTransaction(project, "Premiere AI Harness: 자체시험 자산 정리", children.map(function (item) {
          return function () { return target.folder.createRemoveItemAction(item); };
        }));
      }
      runtime.runTransaction(project, "Premiere AI Harness: 자체시험 빈 정리", [
        function () { return target.parent.createRemoveItemAction(target.folder); },
      ]);
      return true;
    } catch (error) {
      errors.push(runtime.messageOf(error));
      return false;
    }
  }

  async function findInternalFolders(root, ppro) {
    const found = [];
    const queue = [{ folder: root, depth: 0 }];
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      if (cursor >= MAX_FOLDER_SCAN) throw new Error("프로젝트 빈 구조가 너무 커서 안전한 자체시험 정리를 중단했습니다.");
      const current = queue[cursor];
      if (current.depth >= MAX_FOLDER_DEPTH) continue;
      for (const item of await current.folder.getItems() || []) {
        const folder = runtime.safeCast(ppro.FolderItem, item);
        if (!folder) continue;
        const target = { folder, parent: current.folder, depth: current.depth + 1 };
        if (runtime.isInternalName(folder.name)) found.push(target);
        queue.push(target);
      }
    }
    return found;
  }

  return { cleanupGenerated, cleanupInternalArtifacts, findInternalFolders };
});
