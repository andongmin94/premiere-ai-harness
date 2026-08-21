(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PAI = Object.assign(root.PAI || {}, api);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const MAX_SEGMENTS = 20000;
  const MAX_DURATION_SECONDS = 12 * 60 * 60;

  function parseTranscript(input, formatHint) {
    const text = String(input || "").replace(/^\uFEFF/, "").trim();
    if (!text) throw new Error("전사문이 비어 있습니다.");
    const hint = String(formatHint || "").toLowerCase();
    if (hint === "srt" || looksLikeSrt(text)) return parseSrt(text);
    if (hint === "vtt" || /^WEBVTT\b/i.test(text)) return parseWebVtt(text);
    try {
      return parseTranscriptJson(JSON.parse(text));
    } catch (error) {
      if (error && error.code === "PAI_TRANSCRIPT") throw error;
      throw transcriptError("SRT, WebVTT 또는 지원 JSON 형식이 아닙니다.");
    }
  }

  function parseSrt(text) {
    const blocks = normalizeNewlines(text).split(/\n{2,}/);
    const segments = [];
    for (const block of blocks) {
      const lines = block.split("\n").map((line) => line.trimEnd());
      if (!lines.length) continue;
      if (/^\d+$/.test(lines[0].trim())) lines.shift();
      if (!lines.length) continue;
      const timingIndex = lines.findIndex((line) => line.includes("-->"));
      if (timingIndex < 0) continue;
      const timing = parseTimingLine(lines[timingIndex]);
      const body = cleanCaptionText(lines.slice(timingIndex + 1).join(" "));
      if (body) segments.push({ start: timing.start, end: timing.end, text: body });
    }
    return normalizeSegments(segments);
  }

  function parseWebVtt(text) {
    const lines = normalizeNewlines(text).split("\n");
    if (/^WEBVTT\b/i.test(lines[0] || "")) lines.shift();
    const segments = [];
    let index = 0;
    while (index < lines.length) {
      while (index < lines.length && !lines[index].trim()) index += 1;
      if (index >= lines.length) break;
      if (!lines[index].includes("-->") && index + 1 < lines.length && lines[index + 1].includes("-->")) index += 1;
      if (!lines[index] || !lines[index].includes("-->")) {
        index += 1;
        continue;
      }
      const timing = parseTimingLine(lines[index]);
      index += 1;
      const body = [];
      while (index < lines.length && lines[index].trim()) {
        body.push(lines[index]);
        index += 1;
      }
      const caption = cleanCaptionText(body.join(" "));
      if (caption) segments.push({ start: timing.start, end: timing.end, text: caption });
    }
    return normalizeSegments(segments);
  }

  function parseTranscriptJson(value) {
    const arrays = [];
    findSegmentArrays(value, arrays, 0);
    if (!arrays.length) throw transcriptError("JSON에서 타임코드가 있는 전사 구간을 찾지 못했습니다.");
    arrays.sort((a, b) => scoreSegmentArray(b) - scoreSegmentArray(a));
    const segments = arrays[0].map(normalizeJsonSegment).filter(Boolean);
    return normalizeSegments(segments);
  }

  function normalizeSegments(rawSegments) {
    if (!Array.isArray(rawSegments) || rawSegments.length === 0) throw transcriptError("유효한 전사 구간이 없습니다.");
    if (rawSegments.length > MAX_SEGMENTS) throw transcriptError(`전사 구간은 ${MAX_SEGMENTS.toLocaleString()}개를 넘을 수 없습니다.`);
    const segments = rawSegments.map((segment, index) => {
      const start = finiteSeconds(segment.start, `구간 ${index + 1} 시작`);
      const end = finiteSeconds(segment.end, `구간 ${index + 1} 종료`);
      const text = normalizeText(segment.text);
      if (start < 0 || end <= start) throw transcriptError(`구간 ${index + 1}의 시간이 잘못되었습니다.`);
      if (end > MAX_DURATION_SECONDS) throw transcriptError("전사문 길이가 지원 상한을 넘었습니다.");
      if (!text) throw transcriptError(`구간 ${index + 1}의 텍스트가 비어 있습니다.`);
      return Object.freeze({ id: `seg-${String(index + 1).padStart(5, "0")}`, start, end, text, speaker: normalizeText(segment.speaker || "") });
    }).sort((a, b) => a.start - b.start || a.end - b.end);
    for (let i = 1; i < segments.length; i += 1) {
      if (segments[i].start < segments[i - 1].start) throw transcriptError("전사 구간의 순서가 잘못되었습니다.");
    }
    return Object.freeze(segments);
  }

  function findSegmentArrays(value, output, depth) {
    if (depth > 8 || value == null) return;
    if (Array.isArray(value)) {
      if (value.length && value.some(looksLikeJsonSegment)) output.push(value);
      for (const child of value) findSegmentArrays(child, output, depth + 1);
      return;
    }
    if (typeof value === "object") {
      for (const child of Object.values(value)) findSegmentArrays(child, output, depth + 1);
    }
  }

  function looksLikeJsonSegment(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const start = firstDefined(value.start, value.startTime, value.begin, value.inPoint, value.in);
    const end = firstDefined(value.end, value.endTime, value.finish, value.outPoint, value.out);
    const text = firstDefined(value.text, value.transcript, value.caption, value.value);
    return timeLike(start) && timeLike(end) && (typeof text === "string" || Array.isArray(value.words));
  }

  function normalizeJsonSegment(value) {
    if (!looksLikeJsonSegment(value)) return null;
    const start = secondsFromUnknown(firstDefined(value.start, value.startTime, value.begin, value.inPoint, value.in));
    const end = secondsFromUnknown(firstDefined(value.end, value.endTime, value.finish, value.outPoint, value.out));
    const wordText = Array.isArray(value.words) ? value.words.map((word) => firstDefined(word.text, word.word, word.value, "")).join(" ") : "";
    const text = firstDefined(value.text, value.transcript, value.caption, value.value, wordText);
    const speaker = firstDefined(value.speaker, value.speakerName, value.speakerLabel, "");
    return { start, end, text, speaker };
  }

  function scoreSegmentArray(items) {
    let score = 0;
    for (const item of items.slice(0, 50)) {
      if (looksLikeJsonSegment(item)) score += 3;
      if (typeof item?.text === "string") score += 1;
      if (Array.isArray(item?.words)) score += 1;
    }
    return score;
  }

  function parseTimingLine(line) {
    const pieces = String(line).split("-->");
    if (pieces.length !== 2) throw transcriptError(`잘못된 타임코드입니다: ${line}`);
    const left = pieces[0].trim();
    const right = pieces[1].trim().split(/\s+/)[0];
    const start = parseClock(left);
    const end = parseClock(right);
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
      if (/^\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
      if (trimmed.includes(":")) return parseClock(trimmed.replace(/\.(\d{1,3})$/, ",$1"));
    }
    if (value && typeof value === "object") {
      if (Number.isFinite(value.seconds)) return Number(value.seconds);
      if (Number.isFinite(value.value)) return Number(value.value);
    }
    return Number.NaN;
  }

  function timeLike(value) {
    return Number.isFinite(secondsFromUnknown(value));
  }

  function finiteSeconds(value, label) {
    const seconds = secondsFromUnknown(value);
    if (!Number.isFinite(seconds)) throw transcriptError(`${label} 시간이 숫자가 아닙니다.`);
    return Math.round(seconds * 1000) / 1000;
  }

  function cleanCaptionText(text) {
    return normalizeText(String(text || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">"));
  }

  function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeNewlines(value) {
    return String(value || "").replace(/\r\n?/g, "\n");
  }

  function looksLikeSrt(text) {
    return /\d{1,3}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(text);
  }

  function firstDefined() {
    for (const value of arguments) if (value !== undefined && value !== null) return value;
    return undefined;
  }

  function transcriptError(message) {
    const error = new Error(message);
    error.code = "PAI_TRANSCRIPT";
    return error;
  }

  return { parseTranscript, parseSrt, parseWebVtt, parseTranscriptJson, normalizeSegments, normalizeText };
});
