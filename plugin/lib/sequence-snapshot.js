(function (root, factory) {
  if (typeof module === "object" && module.exports && typeof window === "undefined") {
    module.exports = factory(require("./premiere-runtime.js"));
  } else {
    root.PAI = Object.assign(root.PAI || {}, factory(root.PAI));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (runtime) {
  "use strict";

  const SNAPSHOT_FORMAT = 1;
  const TIME_EPSILON = 0.001;

  async function readSequenceSnapshot(ppro, sequence) {
    if (!sequence) throw new Error("시퀀스 구조를 읽을 수 없습니다.");
    const clipType = Number(ppro?.Constants?.TrackItemType?.CLIP);
    if (!Number.isInteger(clipType)) throw new Error("Premiere 트랙 항목 상수를 읽지 못했습니다.");
    const end = readSeconds(await sequence.getEndTime(), "시퀀스 종료");
    const videoTracks = await readTrackGroup(sequence, "video", clipType);
    const audioTracks = await readTrackGroup(sequence, "audio", clipType);
    return normalizeSequenceSnapshot({ formatVersion: SNAPSHOT_FORMAT, end, videoTracks, audioTracks });
  }

  async function readTrackGroup(sequence, kind, clipType) {
    const countMethod = kind === "video" ? "getVideoTrackCount" : "getAudioTrackCount";
    const trackMethod = kind === "video" ? "getVideoTrack" : "getAudioTrack";
    const count = Number(await sequence[countMethod]());
    if (!Number.isInteger(count) || count < 0 || count > 256) throw new Error(`${kind} 트랙 수가 올바르지 않습니다.`);
    const tracks = [];
    for (let index = 0; index < count; index += 1) {
      const track = await sequence[trackMethod](index);
      if (!track || typeof track.getTrackItems !== "function") throw new Error(`${kind} 트랙 ${index + 1}을 읽지 못했습니다.`);
      const rawItems = await runtime.maybePromise(track.getTrackItems(clipType, false));
      if (!Array.isArray(rawItems)) throw new Error(`${kind} 트랙 ${index + 1}의 클립 목록이 올바르지 않습니다.`);
      const items = [];
      for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex += 1) {
        items.push(await readTrackItem(rawItems[itemIndex], `${kind} ${index + 1}/${itemIndex + 1}`));
      }
      tracks.push({ index, items });
    }
    return tracks;
  }

  async function readTrackItem(item, label) {
    if (!item || typeof item.getStartTime !== "function" || typeof item.getEndTime !== "function"
      || typeof item.getProjectItem !== "function") throw new Error(`${label} 트랙 항목 API가 올바르지 않습니다.`);
    const projectItem = await item.getProjectItem();
    const projectItemId = runtime.clipIdentity(projectItem);
    if (!projectItemId) throw new Error(`${label} 원본 식별자를 읽지 못했습니다.`);
    const start = readSeconds(await item.getStartTime(), `${label} 시작`);
    const end = readSeconds(await item.getEndTime(), `${label} 종료`);
    if (end <= start) throw new Error(`${label} 트랙 항목 시간이 올바르지 않습니다.`);
    return {
      projectItemId,
      projectItemName: String(projectItem?.name || ""),
      start,
      end,
    };
  }

  function normalizeSequenceSnapshot(value) {
    if (!value || Number(value.formatVersion) !== SNAPSHOT_FORMAT) throw new Error("시퀀스 구조 기록 형식이 올바르지 않습니다.");
    const end = finiteNonNegative(value.end, "시퀀스 종료");
    const videoTracks = normalizeTracks(value.videoTracks, "video");
    const audioTracks = normalizeTracks(value.audioTracks, "audio");
    return Object.freeze({
      formatVersion: SNAPSHOT_FORMAT,
      end,
      videoTracks,
      audioTracks,
    });
  }

  function normalizeTracks(value, kind) {
    if (!Array.isArray(value) || value.length > 256) throw new Error(`${kind} 트랙 구조가 올바르지 않습니다.`);
    return Object.freeze(value.map((track, index) => {
      if (!track || Number(track.index) !== index || !Array.isArray(track.items)) {
        throw new Error(`${kind} 트랙 ${index + 1} 구조가 올바르지 않습니다.`);
      }
      const items = track.items.map((item, itemIndex) => normalizeItem(item, `${kind} ${index + 1}/${itemIndex + 1}`))
        .sort(compareItems);
      return Object.freeze({ index, items: Object.freeze(items) });
    }));
  }

  function normalizeItem(value, label) {
    const projectItemId = String(value?.projectItemId || "").trim();
    const start = finiteNonNegative(value?.start, `${label} 시작`);
    const end = finiteNonNegative(value?.end, `${label} 종료`);
    if (!projectItemId || end <= start) throw new Error(`${label} 트랙 항목 구조가 올바르지 않습니다.`);
    return Object.freeze({
      projectItemId,
      projectItemName: String(value?.projectItemName || ""),
      start,
      end,
    });
  }

  function validateGeneratedSequenceSnapshot(snapshot, expectedSegments) {
    const normalized = normalizeSequenceSnapshot(snapshot);
    const expected = normalizeExpectedSegments(expectedSegments);
    if (normalized.end <= 0) throw new Error("생성된 시퀀스 길이가 비어 있습니다.");
    const expectedNames = expected.map((item) => item.name);
    const unique = uniqueTimelineItems(normalized);
    if (unique.length !== expected.length) {
      throw new Error("생성된 시퀀스에 예상한 모든 서브클립만 들어 있지 않습니다.");
    }
    validateTrackGroupCoverage(normalized.videoTracks, expectedNames, "video");
    validateTrackGroupCoverage(normalized.audioTracks, expectedNames, "audio");

    let cursor = 0;
    for (let index = 0; index < expected.length; index += 1) {
      const actual = unique[index];
      const wanted = expected[index];
      const expectedEnd = cursor + wanted.duration;
      if (actual.projectItemName !== wanted.name) {
        throw new Error("생성된 시퀀스의 서브클립 순서가 예상과 다릅니다.");
      }
      if (!sameTime(actual.start, cursor) || !sameTime(actual.end, expectedEnd)) {
        throw new Error("생성된 시퀀스의 클립 경계 또는 길이가 예상과 다릅니다.");
      }
      cursor = expectedEnd;
    }
    if (!sameTime(normalized.end, cursor)) {
      throw new Error("생성된 시퀀스 종료 시간이 예상 유지 구간 합계와 다릅니다.");
    }
    return normalized;
  }

  function validateSequenceSegmentCount(snapshot, expectedCount) {
    const normalized = normalizeSequenceSnapshot(snapshot);
    const count = Number(expectedCount);
    if (!Number.isInteger(count) || count <= 0) throw new Error("예상 러프컷 구간 수가 올바르지 않습니다.");
    const uniqueItems = uniqueTimelineItems(normalized);
    if (normalized.end <= 0 || uniqueItems.length !== count) {
      throw new Error(`러프컷 시퀀스 구조가 예상 ${count}개 구간과 일치하지 않습니다.`);
    }
    return normalized;
  }

  function sameSequenceSnapshot(left, right) {
    try {
      return JSON.stringify(normalizeSequenceSnapshot(left)) === JSON.stringify(normalizeSequenceSnapshot(right));
    } catch (_) {
      return false;
    }
  }

  function normalizeExpectedSegments(value) {
    if (!Array.isArray(value) || value.length === 0) throw new Error("검증할 생성 구간이 없습니다.");
    const names = new Set();
    return value.map((item, index) => {
      const name = String(item?.name || "").trim();
      const duration = Number(item?.duration);
      if (!name || names.has(name)) throw new Error("검증할 생성 서브클립 이름이 올바르지 않습니다.");
      if (!Number.isFinite(duration) || duration <= 0 || duration > 12 * 60 * 60) {
        throw new Error(`검증할 생성 구간 ${index + 1}의 길이가 올바르지 않습니다.`);
      }
      names.add(name);
      return Object.freeze({ name, duration });
    });
  }

  function uniqueTimelineItems(snapshot) {
    const grouped = new Map();
    for (const item of allItems(snapshot)) {
      const existing = grouped.get(item.projectItemId);
      if (!existing) {
        grouped.set(item.projectItemId, item);
        continue;
      }
      if (existing.projectItemName !== item.projectItemName
        || !sameTime(existing.start, item.start) || !sameTime(existing.end, item.end)) {
        throw new Error("같은 생성 서브클립의 A/V 경계가 서로 일치하지 않습니다.");
      }
    }
    return [...grouped.values()].sort(compareItems);
  }

  function validateTrackGroupCoverage(tracks, expectedNames, kind) {
    const items = tracks.flatMap((track) => track.items);
    if (!items.length) return;
    const names = new Set(items.map((item) => item.projectItemName));
    if (names.size !== expectedNames.length || expectedNames.some((name) => !names.has(name))) {
      throw new Error(`생성된 시퀀스의 ${kind} 트랙에 일부 유지 구간이 빠졌습니다.`);
    }
  }

  function allItems(snapshot) {
    return [...snapshot.videoTracks, ...snapshot.audioTracks].flatMap((track) => track.items);
  }

  function readSeconds(value, label) {
    const raw = typeof value === "number" ? value : value?.seconds;
    return finiteNonNegative(raw, label);
  }

  function finiteNonNegative(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > 12 * 60 * 60) throw new Error(`${label} 시간이 올바르지 않습니다.`);
    return Math.round(number * 1000000) / 1000000;
  }

  function sameTime(left, right) {
    return Math.abs(Number(left) - Number(right)) <= TIME_EPSILON;
  }

  function compareItems(left, right) {
    return left.start - right.start || left.end - right.end
      || left.projectItemId.localeCompare(right.projectItemId, "en");
  }

  return {
    SNAPSHOT_FORMAT,
    readSequenceSnapshot,
    normalizeSequenceSnapshot,
    validateGeneratedSequenceSnapshot,
    validateSequenceSegmentCount,
    sameSequenceSnapshot,
  };
});
