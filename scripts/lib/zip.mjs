import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const CRC_TABLE = buildCrcTable();

export function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function createZip(entries, outputFile, options = {}) {
  const normalized = entries
    .map((entry) => ({
      name: normalizeName(entry.name),
      data: Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data),
      mode: Number(entry.mode || 0o100644),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "en"));
  const date = options.date instanceof Date ? options.date : resolveArchiveDate();
  const { dosDate, dosTime } = toDosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of normalized) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const checksum = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(((entry.mode & 0xffff) * 0x10000) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }

  const centralOffset = offset;
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(normalized.length, 8);
  end.writeUInt16LE(normalized.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  const temporary = `${outputFile}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, Buffer.concat([...locals, ...centrals, end]));
  fs.renameSync(temporary, outputFile);
  return { outputFile, entries: normalized.length, bytes: fs.statSync(outputFile).size };
}

export function createZipFromDirectory(sourceDir, outputFile, options = {}) {
  const entries = collectDirectoryEntries(sourceDir, options);
  return createZip(entries, outputFile, options);
}

export function collectDirectoryEntries(sourceDir, options = {}) {
  const root = path.resolve(sourceDir);
  const prefix = options.prefix ? `${normalizeName(options.prefix).replace(/\/$/, "")}/` : "";
  const filter = typeof options.filter === "function" ? options.filter : () => true;
  const entries = [];
  walk(root, "");
  return entries;

  function walk(current, relative) {
    const names = fs.readdirSync(current).sort((a, b) => a.localeCompare(b, "en"));
    for (const name of names) {
      const full = path.join(current, name);
      const rel = relative ? path.join(relative, name) : name;
      const stat = fs.lstatSync(full);
      if (!filter(rel, stat)) continue;
      if (stat.isDirectory()) walk(full, rel);
      else if (stat.isFile()) entries.push({ name: `${prefix}${normalizeName(rel)}`, data: fs.readFileSync(full), mode: stat.mode });
      else if (stat.isSymbolicLink()) {
        const target = fs.readlinkSync(full);
        entries.push({ name: `${prefix}${normalizeName(rel)}`, data: Buffer.from(target), mode: 0o120777 });
      }
    }
  }
}

export function readZipEntries(zipFile) {
  const archive = fs.readFileSync(zipFile);
  const eocd = findSignatureBackwards(archive, 0x06054b50, Math.max(0, archive.length - 65557));
  if (eocd < 0) throw new Error(`Invalid ZIP: end-of-central-directory not found in ${zipFile}`);
  const count = archive.readUInt16LE(eocd + 10);
  const centralOffset = archive.readUInt32LE(eocd + 16);
  const result = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) throw new Error(`Invalid ZIP central directory entry ${index}`);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const uncompressedSize = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (archive.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`Invalid ZIP local entry for ${name}`);
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataOffset, dataOffset + compressedSize);
    const data = method === 8 ? zlib.inflateRawSync(compressed) : method === 0 ? Buffer.from(compressed) : null;
    if (!data) throw new Error(`Unsupported ZIP method ${method} for ${name}`);
    if (data.length !== uncompressedSize) throw new Error(`ZIP size mismatch for ${name}`);
    if (crc32(data) !== checksum) throw new Error(`ZIP CRC mismatch for ${name}`);
    result.set(name, data);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}

function normalizeName(value) {
  const name = String(value || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!name || name.includes("../") || name === "..") throw new Error(`Unsafe ZIP entry name: ${value}`);
  return name;
}

function resolveArchiveDate() {
  const epoch = Number(process.env.SOURCE_DATE_EPOCH || 0);
  if (Number.isFinite(epoch) && epoch > 0) return new Date(epoch * 1000);
  return new Date("2026-08-16T00:00:00.000Z");
}

function toDosDateTime(date) {
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = Math.floor(date.getUTCSeconds() / 2);
  return {
    dosDate: ((year - 1980) << 9) | (month << 5) | day,
    dosTime: (hours << 11) | (minutes << 5) | seconds,
  };
}

function findSignatureBackwards(buffer, signature, start) {
  for (let offset = buffer.length - 4; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  return -1;
}

function buildCrcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 8) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
}
