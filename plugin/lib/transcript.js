(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports && typeof window === "undefined") module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SEGMENTS = 20000;
  const MAX_DURATION_SECONDS = 12 * 60 * 60;
  const MAX_INPUT_CHARS = 16 * 1024 * 1024;
  const MAX_JSON_ARRAY_ITEMS = 40000;
  const MAX_JSON_TRAVERSAL_UNITS = 500000;
  const MAX_SEGMENT_TEXT_CHARS = 64 * 1024;
  const MAX_TOTAL_TEXT_CHARS = 4 * 1024 * 1024;
  const MAX_SPEAKER_CHARS = 4096;
  const MAX_WORDS_PER_SEGMENT = 5000;
  const ARRAY_KEY_PRIORITY = Object.freeze({
    segments: 10000,
    captions: 8000,
    utterances: 7000,
    transcript: 6000,
    transcripts: 6000,
    results: 1000,
    items: 500,
  });
  const REJECTED_ARRAY_KEYS = new Set(["words", "word", "tokens", "token"]);

  function parseTranscript(input, formatHint) {
    const text = requireTranscriptText(input);
    const hint = String(formatHint || "").toLowerCase();
    if (hint === "vtt") return parseWebVtt(text);
    if (hint === "srt") return parseSrt(text);
    if (/^WEBVTT\b/i.test(text)) return parseWebVtt(text);
    if (looksLikeSrt(text)) return parseSrt(text);
    try { return parseTranscriptJson(JSON.parse(text)); }
    catch (error) {
      if (error?.code === "PAI_TRANSCRIPT") throw error;
      throw transcriptError("SRT, WebVTT 또는 지원 JSON 형식이 아닙니다.");
    }
  }

  function parseSrt(input) {
    const text = requireTranscriptText(input);
    const blocks = normalizeNewlines(text).split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    const segments = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const lines = blocks[blockIndex].split("\n").map((line) => line.trimEnd());
      if (/^\d+$/.test(lines[0]?.trim())) lines.shift();
      if (!lines.length || !lines[0].includes("-->")) throw transcriptError(`SRT ${blockIndex + 1}번 자막의 타임코드를 찾지 못했습니다.`);
      const timing = parseTimingLine(lines[0]);
      const body = cleanCaptionText(lines.slice(1).join(" "));
      if (!body) throw transcriptError(`SRT ${blockIndex + 1}번 자막의 텍스트가 비어 있습니다.`);
      segments.push({ start: timing.start, end: timing.end, text: body });
      requireSegmentCount(segments.length);
    }
    return normalizeSegments(segments);
  }

  function parseWebVtt(input) {
    const text = requireTranscriptText(input);
    const normalized = normalizeNewlines(text);
    const lines = normalized.split("\n");
    if (!/^WEBVTT(?:\s|$)/i.test(String(lines[0] || "").trim())) throw transcriptError("WebVTT 헤더가 없습니다.");
    let cursor = 1;
    while (cursor < lines.length && lines[cursor].trim()) cursor += 1;
    while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
    const blocks = lines.slice(cursor).join("\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
    const segments = [];
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
      const lines = blocks[blockIndex].split("\n").map((line) => line.trimEnd());
      const marker = String(lines[0] || "").trim().toUpperCase();
      if (marker === "STYLE" || marker === "REGION" || marker.startsWith("NOTE")) continue;
      const timingIndex = lines[0]?.includes("-->") ? 0 : lines[1]?.includes("-->") ? 1 : -1;
      if (timingIndex < 0) throw transcriptError(`WebVTT ${blockIndex + 1}번 cue의 타임코드를 찾지 못했습니다.`);
      const timing = parseTimingLine(lines[timingIndex]);
      const caption = cleanCaptionText(lines.slice(timingIndex + 1).join(" "));
      if (!caption) throw transcriptError(`WebVTT ${blockIndex + 1}번 cue의 텍스트가 비어 있습니다.`);
      segments.push({ start: timing.start, end: timing.end, text: caption });
      requireSegmentCount(segments.length);
    }
    return normalizeSegments(segments);
  }

  function parseTranscriptJson(value) {
    const candidates = [];
    findSegmentArrays(value, candidates, [], 0, { units: 0 });
    const usable = candidates.map((candidate) => Object.assign(candidate, { score: scoreSegmentArray(candidate) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || right.items.length - left.items.length);
    if (!usable.length) throw transcriptError("JSON에서 타임코드가 있는 전사 구간을 찾지 못했습니다.");
    requireSegmentCount(usable[0].items.length);
    return normalizeSegments(usable[0].items.map(normalizeJsonSegment).filter(Boolean));
  }

  function normalizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) throw transcriptError("유효한 전사 구간이 없습니다.");
    requireSegmentCount(rawSegments.length);
    let totalTextChars = 0;
    const segments = rawSegments.map((segment, index) => {
      const start = finiteSeconds(segment.start, `구간 ${index + 1} 시작`);
      const end = finiteSeconds(segment.end, `구간 ${index + 1} 종료`);
      const text = normalizeText(segment.text);
      const speaker = normalizeText(segment.speaker || "");
      if (start < 0 || end <= start) throw transcriptError(`구간 ${index + 1}의 시간이 잘못되었습니다.`);
      if (end > MAX_DURATION_SECONDS) throw transcriptError("전사문 길이가 지원 상한을 넘었습니다.");
      if (!text) throw transcriptError(`구간 ${index + 1}의 텍스트가 비어 있습니다.`);
      if (text.length > MAX_SEGMENT_TEXT_CHARS) throw transcriptError(`구간 ${index + 1}의 텍스트가 너무 깁니다.`);
      if (speaker.length > MAX_SPEAKER_CHARS) throw transcriptError(`구간 ${index + 1}의 화자 이름이 너무 깁니다.`);
      totalTextChars += text.length + speaker.length;
      if (totalTextChars > MAX_TOTAL_TEXT_CHARS) throw transcriptError("전사문 텍스트 총량이 지원 상한을 넘었습니다.");
      return { start, end, text, speaker };
    }).sort((left, right) => left.start - right.start || left.end - right.end)
      .map((segment, index) => Object.freeze(Object.assign({ id: `seg-${String(index + 1).padStart(5, "0")}` }, segment)));
    return Object.freeze(segments);
  }

  function findSegmentArrays(value, output, path, depth, budget) {
    if (depth > 8 || value == null || typeof value !== "object") return;
    chargeTraversal(budget, 1);
    if (Array.isArray(value)) {
      const lastKey = String(path[path.length - 1] || "").toLowerCase();
      if (REJECTED_ARRAY_KEYS.has(lastKey)) return;
      if (value.length > MAX_JSON_ARRAY_ITEMS) throw transcriptError("전사 JSON 배열이 너무 커서 안전하게 분석할 수 없습니다.");
      chargeTraversal(budget, value.length);
      if (value.length && value.some(looksLikeJsonSegment)) output.push({ items: value, path: path.slice() });
      for (let index = 0; index < value.length; index += 1) findSegmentArrays(value[index], output, path.concat(String(index)), depth + 1, budget);
      return;
    }
    const entries = Object.entries(value);
    chargeTraversal(budget, entries.length);
    for (const [key, child] of entries) findSegmentArrays(child, output, path.concat(key), depth + 1, budget);
  }

  function looksLikeJsonSegment(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const start = readStart(value);
    const end = readEnd(value, start);
    const explicitText = typeof firstDefined(value.text, value.transcript, value.caption) === "string";
    const words = Array.isArray(value.words) && value.words.length > 0;
    return timeLike(start) && timeLike(end) && (explicitText || words || typeof value.value === "string");
  }

  function normalizeJsonSegment(value) {
    if (!looksLikeJsonSegment(value)) return null;
    const startRaw = readStart(value);
    const start = secondsFromUnknown(startRaw);
    const end = secondsFromUnknown(readEnd(value, startRaw));
    const directText = firstDefined(value.text, value.transcript, value.caption);
    let wordText = "";
    if (directText === undefined && Array.isArray(value.words)) {
      if (value.words.length > MAX_WORDS_PER_SEGMENT) throw transcriptError("한 전사 구간의 단어 수가 지원 상한을 넘었습니다.");
      wordText = value.words.map((word) => firstDefined(word?.text, word?.word, word?.value, "")).join(" ");
    }
    return {
      start,
      end,
      text: firstDefined(directText, wordText, value.value),
      speaker: firstDefined(value.speaker, value.speakerName, value.speakerLabel, ""),
    };
  }

  function scoreSegmentArray(candidate) {
    const sample = candidate.items.slice(0, 100);
    const segmentLike = sample.filter(looksLikeJsonSegment);
    if (!segmentLike.length || segmentLike.length / sample.length < 0.7) return 0;
    const path = candidate.path.map((part) => String(part).toLowerCase());
    const lastKey = path[path.length - 1] || "";
    if (REJECTED_ARRAY_KEYS.has(lastKey)) return 0;
    const keyPriority = ARRAY_KEY_PRIORITY[lastKey] || 0;
    const transcriptPath = path.some((part) => /transcript|caption|utterance|speech/.test(part));
    let score = keyPriority + (transcriptPath ? 250 : 0) + Math.min(segmentLike.length, 100) * 5;
    for (const item of segmentLike) {
      if (typeof item.text === "string" || typeof item.transcript === "string" || typeof item.caption === "string") score += 8;
      else if (Array.isArray(item.words)) score += 4;
      else if (typeof item.value === "string") score += keyPriority || transcriptPath ? 1 : -8;
    }
    if (!keyPriority && !transcriptPath
      && segmentLike.every((item) => typeof item.value === "string" && !item.text && !item.transcript && !item.caption && !item.words)) return 0;
    return score;
  }

  function readStart(value) { return firstDefined(value.start, value.startTime, value.begin, value.inPoint, value.in); }
  function readEnd(value, startValue) {
    const direct = firstDefined(value.end, value.endTime, value.finish, value.outPoint, value.out);
    if (direct !== undefined) return direct;
    const start = secondsFromUnknown(startValue);
    const duration = secondsFromUnknown(firstDefined(value.duration, value.length));
    return Number.isFinite(start) && Number.isFinite(duration) ? start + duration : undefined;
  }

  function parseTimingLine(line) {
    const pieces = String(line).split("-->");
    if (pieces.length !== 2) throw transcriptError(`잘못된 타임코드입니다: ${line}`);
    const start = parseClock(pieces[0].trim());
    const end = parseClock(pieces[1].trim().split(/\s+/)[0]);
    if (end <= start) throw transcriptError(`종료 시간이 시작 시간보다 빠릅니다: ${line}`);
    return { start, end };
  }

  function parseClock(value) {
    const match = String(value).trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})$/);
    if (!match) throw transcriptError(`지원하지 않는 시간 표기입니다: ${value}`);
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2]);
    const seconds = Number(match[3]);
    const millis = Number(match[4].padEnd(3, "0"));
    if (minutes > 59 || seconds > 59) throw transcriptError(`잘못된 시간 값입니다: ${value}`);
    return hours * 3600 + minutes * 60 + seconds + millis / 1000;
  }

  function secondsFromUnknown(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
      if (trimmed.includes(":")) return parseClock(trimmed.replace(/\.(\d{1,3})$/, ",$1"));
    }
    if (value && typeof value === "object") {
      if (Number.isFinite(value.seconds)) return Number(value.seconds);
      if (Number.isFinite(value.value)) return Number(value.value);
    }
    return Number.NaN;
  }

  function requireTranscriptText(value) {
    const text = String(value || "").replace(/^\uFEFF/, "").trim();
    if (!text) throw transcriptError("전사문이 비어 있습니다.");
    if (text.length > MAX_INPUT_CHARS) throw transcriptError(`전사문 입력은 ${MAX_INPUT_CHARS.toLocaleString()}자를 넘을 수 없습니다.`);
    return text;
  }

  function requireSegmentCount(count) {
    if (count > MAX_SEGMENTS) throw transcriptError(`전사 구간은 ${MAX_SEGMENTS.toLocaleString()}개를 넘을 수 없습니다.`);
  }

  function chargeTraversal(budget, amount) {
    budget.units += amount;
    if (budget.units > MAX_JSON_TRAVERSAL_UNITS) throw transcriptError("전사 JSON 구조가 너무 커서 안전하게 분석할 수 없습니다.");
  }

  function timeLike(value) { return Number.isFinite(secondsFromUnknown(value)); }
  function finiteSeconds(value, label) { const seconds = secondsFromUnknown(value); if (!Number.isFinite(seconds)) throw transcriptError(`${label} 시간이 숫자가 아닙니다.`); return Math.round(seconds * 1000) / 1000; }
  function cleanCaptionText(text) { return normalizeText(String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")); }
  function normalizeText(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
  function normalizeNewlines(value) { return String(value || "").replace(/\r\n?/g, "\n"); }
  function looksLikeSrt(text) { return /\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text); }
  function firstDefined() { for (const value of arguments) if (value !== undefined && value !== null) return value; return undefined; }
  function transcriptError(message) { const error = new Error(message); error.code = "PAI_TRANSCRIPT"; return error; }

  return { parseTranscript, parseSrt, parseWebVtt, parseTranscriptJson, normalizeSegments, normalizeText };
});
