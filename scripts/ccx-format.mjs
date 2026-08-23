import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const DATA_DESCRIPTOR_FLAG = 0x0008;
const ENCRYPTED_FLAG = 0x0001;
const UTF8_FLAG = 0x0800;
const FIXED_DOS_DATE = 0x0021;
const FIXED_DOS_TIME = 0x0000;
const CRC_TABLE = buildCrcTable();

export function inspectCcx(file) {
  const archive = fs.readFileSync(file);
  const eocdOffset = findEocd(archive);
  requireRange(archive, eocdOffset, 22, "ZIP end record");

  const disk = archive.readUInt16LE(eocdOffset + 4);
  const centralDisk = archive.readUInt16LE(eocdOffset + 6);
  const entriesOnDisk = archive.readUInt16LE(eocdOffset + 8);
  const entryCount = archive.readUInt16LE(eocdOffset + 10);
  const centralSize = archive.readUInt32LE(eocdOffset + 12);
  const centralOffset = archive.readUInt32LE(eocdOffset + 16);
  const commentLength = archive.readUInt16LE(eocdOffset + 20);

  assert(disk === 0 && centralDisk === 0, "multi-disk CCX archives are not supported");
  assert(entriesOnDisk === entryCount, "CCX central-directory entry counts differ");
  assert(entryCount > 0 && entryCount < 65535, "CCX entry count is invalid or requires ZIP64");
  assert(centralSize !== 0xffffffff && centralOffset !== 0xffffffff, "ZIP64 CCX archives are not supported");
  assert(commentLength === 0, "CCX archive comments are not allowed");
  assert(eocdOffset + 22 === archive.length, "CCX contains trailing bytes after its end record");
  assert(centralOffset + centralSize === eocdOffset, "CCX central-directory bounds are invalid");
  requireRange(archive, centralOffset, centralSize, "CCX central directory");

  const entries = [];
  const names = new Set();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    requireRange(archive, cursor, 46, `central entry ${index + 1}`);
    assert(archive.readUInt32LE(cursor) === CENTRAL_SIGNATURE, `central entry ${index + 1} has an invalid signature`);

    const versionMadeBy = archive.readUInt16LE(cursor + 4);
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const dosTime = archive.readUInt16LE(cursor + 12);
    const dosDate = archive.readUInt16LE(cursor + 14);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const diskStart = archive.readUInt16LE(cursor + 34);
    const externalAttributes = archive.readUInt32LE(cursor + 38);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const headerLength = 46 + nameLength + extraLength + entryCommentLength;
    requireRange(archive, cursor, headerLength, `central entry ${index + 1}`);

    const nameBuffer = archive.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeName(nameBuffer, flags);
    validateEntryName(name);
    assert(!names.has(name), `duplicate CCX entry: ${name}`);
    names.add(name);

    assert((flags & ENCRYPTED_FLAG) === 0, `encrypted CCX entry is not allowed: ${name}`);
    assert((flags & DATA_DESCRIPTOR_FLAG) === 0, `ZIP data descriptors are not allowed in CCX: ${name}`);
    assert(method === 0 || method === 8, `unsupported CCX compression method ${method}: ${name}`);
    assert(dosDate === FIXED_DOS_DATE && dosTime === FIXED_DOS_TIME, `CCX entry timestamp is not deterministic: ${name}`);
    assert(extraLength === 0 && entryCommentLength === 0, `CCX entry metadata is not minimal: ${name}`);
    assert(diskStart === 0, `CCX entry starts on another disk: ${name}`);
    assert(compressedSize !== 0xffffffff && uncompressedSize !== 0xffffffff && localOffset !== 0xffffffff,
      `ZIP64 CCX entry is not supported: ${name}`);
    assertRegularFile(versionMadeBy, externalAttributes, name);

    const local = readLocalEntry(archive, localOffset, {
      name,
      flags,
      method,
      dosTime,
      dosDate,
      checksum,
      compressedSize,
      uncompressedSize,
    });
    const data = method === 0 ? Buffer.from(local.compressed) : inflate(local.compressed, name);
    assert(data.length === uncompressedSize, `CCX uncompressed size mismatch: ${name}`);
    assert(crc32(data) === checksum, `CCX CRC mismatch: ${name}`);

    entries.push(Object.freeze({
      name,
      bytes: data.length,
      compressedBytes: compressedSize,
      crc32: checksum.toString(16).padStart(8, "0"),
      sha256: sha256(data),
      method,
      flags,
      localOffset,
      localEnd: local.end,
      data,
    }));
    cursor += headerLength;
  }

  assert(cursor === centralOffset + centralSize, "CCX central directory contains unparsed data");
  verifyLocalLayout(entries, centralOffset);
  assert(entries.some((entry) => entry.name === "manifest.json"), "CCX manifest.json must exist at the archive root");

  return Object.freeze({
    file,
    bytes: archive.length,
    sha256: sha256(archive),
    entries: Object.freeze(entries),
  });
}

export function verifyCcxAgainstDirectory(file, sourceDirectory) {
  const inspected = inspectCcx(file);
  const expectedFiles = listFiles(sourceDirectory).map((sourceFile) => ({
    name: normalizePath(path.relative(sourceDirectory, sourceFile)),
    data: fs.readFileSync(sourceFile),
  })).sort((left, right) => left.name.localeCompare(right.name, "en"));
  const actualNames = inspected.entries.map((entry) => entry.name);
  const expectedNames = expectedFiles.map((entry) => entry.name);
  assert(JSON.stringify(actualNames) === JSON.stringify(expectedNames), "CCX file list differs from the staged UXP source directory");
  for (let index = 0; index < expectedFiles.length; index += 1) {
    assert(inspected.entries[index].data.equals(expectedFiles[index].data), `CCX entry differs from staged source: ${expectedFiles[index].name}`);
  }
  return inspected;
}

export function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function readLocalEntry(archive, offset, expected) {
  requireRange(archive, offset, 30, `local entry ${expected.name}`);
  assert(archive.readUInt32LE(offset) === LOCAL_SIGNATURE, `local entry has an invalid signature: ${expected.name}`);
  const flags = archive.readUInt16LE(offset + 6);
  const method = archive.readUInt16LE(offset + 8);
  const dosTime = archive.readUInt16LE(offset + 10);
  const dosDate = archive.readUInt16LE(offset + 12);
  const checksum = archive.readUInt32LE(offset + 14);
  const compressedSize = archive.readUInt32LE(offset + 18);
  const uncompressedSize = archive.readUInt32LE(offset + 22);
  const nameLength = archive.readUInt16LE(offset + 26);
  const extraLength = archive.readUInt16LE(offset + 28);
  const headerLength = 30 + nameLength + extraLength;
  requireRange(archive, offset, headerLength, `local entry ${expected.name}`);
  const name = decodeName(archive.subarray(offset + 30, offset + 30 + nameLength), flags);

  assert(name === expected.name, `local and central entry names differ: ${expected.name}`);
  assert(flags === expected.flags, `local and central flags differ: ${expected.name}`);
  assert(method === expected.method, `local and central compression methods differ: ${expected.name}`);
  assert(dosTime === expected.dosTime && dosDate === expected.dosDate, `local and central timestamps differ: ${expected.name}`);
  assert(checksum === expected.checksum, `local and central CRC values differ: ${expected.name}`);
  assert(compressedSize === expected.compressedSize, `local and central compressed sizes differ: ${expected.name}`);
  assert(uncompressedSize === expected.uncompressedSize, `local and central uncompressed sizes differ: ${expected.name}`);
  assert(extraLength === 0, `local CCX extra fields are not allowed: ${expected.name}`);

  const dataOffset = offset + headerLength;
  requireRange(archive, dataOffset, compressedSize, `compressed data ${expected.name}`);
  return { compressed: archive.subarray(dataOffset, dataOffset + compressedSize), end: dataOffset + compressedSize };
}

function verifyLocalLayout(entries, centralOffset) {
  const byOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  assert(byOffset[0]?.localOffset === 0, "CCX local entries must begin at byte zero");
  for (let index = 1; index < byOffset.length; index += 1) {
    assert(byOffset[index - 1].localEnd === byOffset[index].localOffset, `CCX contains hidden bytes before ${byOffset[index].name}`);
  }
  assert(byOffset.at(-1)?.localEnd === centralOffset, "CCX contains hidden bytes before its central directory");
}

function assertRegularFile(versionMadeBy, externalAttributes, name) {
  const hostSystem = versionMadeBy >>> 8;
  if (hostSystem !== 3) return;
  const mode = (externalAttributes >>> 16) & 0xffff;
  const type = mode & 0o170000;
  assert(type === 0 || type === 0o100000, `CCX entry is not a regular file: ${name}`);
}

function decodeName(buffer, flags) {
  const value = buffer.toString((flags & UTF8_FLAG) !== 0 ? "utf8" : "latin1");
  assert(!value.includes("\u0000"), "CCX entry name contains a NUL byte");
  return value;
}

function validateEntryName(name) {
  assert(name.length > 0, "CCX entry name is empty");
  assert(!name.includes("\\"), `CCX entry uses a backslash: ${name}`);
  assert(!name.startsWith("/") && !/^[A-Za-z]:/.test(name), `CCX entry is absolute: ${name}`);
  assert(!name.endsWith("/"), `CCX directory entries are not allowed: ${name}`);
  const parts = name.split("/");
  assert(parts.every((part) => part && part !== "." && part !== ".."), `unsafe CCX entry path: ${name}`);
}

function findEocd(buffer) {
  const minimum = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= minimum; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("CCX end-of-central-directory record was not found");
}

function inflate(buffer, name) {
  try { return zlib.inflateRawSync(buffer); }
  catch (error) { throw new Error(`CCX deflate stream is invalid for ${name}: ${error.message}`); }
}

function listFiles(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...listFiles(full));
    else if (entry.isFile()) output.push(full);
    else throw new Error(`unsupported staged source entry: ${full}`);
  }
  return output;
}

function requireRange(buffer, offset, length, label) {
  assert(Number.isInteger(offset) && Number.isInteger(length) && offset >= 0 && length >= 0
    && offset + length <= buffer.length, `${label} exceeds CCX bounds`);
}

function normalizePath(value) { return String(value).replace(/\\/g, "/"); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function assert(condition, message) { if (!condition) throw new Error(message); }

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
}
