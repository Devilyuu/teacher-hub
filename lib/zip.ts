/**
 * 只存储不压缩（method 0）的流式 ZIP 打包器。
 *
 * **为什么自己写而不是装 archiver / yazl**：要打包的全是 PDF、docx、图片这类
 * 已压缩格式，再 deflate 一遍省不下空间，只白烧 CPU；store 模式反而更快。
 * 而 store 的格式简单到能写完整单测，零依赖也让流式控制完全在自己手里。
 *
 * **这个模块不碰磁盘**，数据源由调用方以「能重放的字节流」形式给进来——
 * 这样它是纯函数，可以拿内存里的 Uint8Array 做往返测试。
 *
 * ZIP64 **不实现**。超出 32 位字段能表达的范围时显式抛错，
 * 绝不静默产出一个解不开的包（见 assertWithinZip32）。
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;

/** 2.0：store + 目录，够用 */
const VERSION = 20;
/**
 * bit 11 (EFS)：文件名是 UTF-8。
 *
 * 不设这一位的话，解压工具会按本机代码页解释文件名——
 * 中文材料名在非中文 Windows 上就是一串乱码。
 */
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;

/** 32 位字段的上限。超过就必须走 ZIP64，而我们不实现 ZIP64 */
const MAX_UINT32 = 0xffffffff;
const MAX_UINT16 = 0xffff;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(chunk: Uint8Array, previous = 0): number {
  let crc = (previous ^ -1) >>> 0;
  for (let i = 0; i < chunk.length; i++) {
    crc = (CRC_TABLE[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ -1) >>> 0;
}

/**
 * DOS 时间戳。ZIP 只有 2 秒精度，且纪元从 1980 年开始——
 * 更早的时间没法表达，夹到 1980-01-01（附件的 uploadedAt 不可能更早，
 * 但库被改过或时钟错乱时不该让整个包打不出来）。
 */
export function toDosDateTime(date: Date): { time: number; date: number } {
  const year = date.getFullYear();
  if (year < 1980) return { time: 0, date: (1 << 5) | 1 };

  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: dosDate };
}

export type ZipSource = {
  /** 包内路径。调用方负责清理，这里只做最后一道兜底检查 */
  name: string;
  mtime: Date;
  /**
   * 逐块读出内容。**会被调用两次**：第一遍算 CRC-32 和字节数，第二遍写进包里。
   *
   * 之所以读两遍而不是用 data descriptor（把 CRC 写在数据后面）：
   * Windows 资源管理器对「store + data descriptor」的组合历来兼容不好，
   * 而这个包的第一读者就是 Windows。两遍都是分块读，内存占用与文件大小无关。
   */
  read: () => AsyncIterable<Uint8Array>;
};

function assertWithinZip32(value: number, what: string) {
  if (value > MAX_UINT32) {
    throw new Error(
      `${what} 超过 4GB，需要 ZIP64，而本打包器不支持。请分批下载，不要产出打不开的包。`,
    );
  }
}

/** 文件名里绝不能出现的东西。清理是调用方的事，这里只兜底，防止绝对路径或穿越进包 */
function assertSafeEntryName(name: string) {
  if (name.length === 0) throw new Error("ZIP 条目名为空");
  if (name.startsWith("/") || name.startsWith("\\") || /^[a-zA-Z]:/.test(name)) {
    throw new Error(`ZIP 条目名不能是绝对路径：${name}`);
  }
  if (name.split(/[/\\]/).some((segment) => segment === "..")) {
    throw new Error(`ZIP 条目名不能包含上级目录：${name}`);
  }
  if (Buffer.byteLength(name, "utf8") > MAX_UINT16) {
    throw new Error(`ZIP 条目名过长：${name}`);
  }
}

type EntryRecord = {
  nameBytes: Buffer;
  crc: number;
  size: number;
  offset: number;
  time: number;
  date: number;
};

function localHeader(entry: EntryRecord): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(FLAG_UTF8, 6);
  header.writeUInt16LE(METHOD_STORE, 8);
  header.writeUInt16LE(entry.time, 10);
  header.writeUInt16LE(entry.date, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18); // store：压缩后 = 原始大小
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(entry.nameBytes.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, entry.nameBytes]);
}

function centralHeader(entry: EntryRecord): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(FLAG_UTF8, 8);
  header.writeUInt16LE(METHOD_STORE, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameBytes.length, 28);
  header.writeUInt16LE(0, 30); // extra
  header.writeUInt16LE(0, 32); // comment
  header.writeUInt16LE(0, 34); // disk number
  header.writeUInt16LE(0, 36); // internal attrs
  header.writeUInt32LE(0, 38); // external attrs
  header.writeUInt32LE(entry.offset, 42);
  return Buffer.concat([header, entry.nameBytes]);
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIGNATURE, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(size, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return eocd;
}

/**
 * 生成 ZIP 字节流。
 *
 * 每个条目读两遍：先算 CRC，再写数据。任一遍读出的字节数对不上就抛错——
 * 宁可让下载失败，也不要给出一个大小对不上、解压报 CRC 错的包。
 */
export async function* zipStream(sources: Iterable<ZipSource>): AsyncGenerator<Buffer> {
  const records: EntryRecord[] = [];
  let offset = 0;

  for (const source of sources) {
    assertSafeEntryName(source.name);

    // 第一遍：算 CRC 和真实字节数
    let crc = 0;
    let size = 0;
    for await (const chunk of source.read()) {
      crc = crc32(chunk, crc);
      size += chunk.length;
    }
    assertWithinZip32(size, `条目「${source.name}」`);

    const { time, date } = toDosDateTime(source.mtime);
    const record: EntryRecord = {
      nameBytes: Buffer.from(source.name, "utf8"),
      crc,
      size,
      offset,
      time,
      date,
    };

    const header = localHeader(record);
    yield header;
    offset += header.length;

    // 第二遍：写数据。字节数必须和第一遍一致，否则包是坏的
    let written = 0;
    for await (const chunk of source.read()) {
      written += chunk.length;
      if (written > size) {
        throw new Error(`条目「${source.name}」两遍读到的大小不一致，打包中止`);
      }
      yield Buffer.from(chunk);
    }
    if (written !== size) {
      throw new Error(`条目「${source.name}」两遍读到的大小不一致，打包中止`);
    }
    offset += size;
    assertWithinZip32(offset, "压缩包");

    records.push(record);
  }

  if (records.length > MAX_UINT16) {
    throw new Error(
      `条目数 ${records.length} 超过 65535，需要 ZIP64，而本打包器不支持。请分批下载。`,
    );
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const record of records) {
    const header = centralHeader(record);
    centralSize += header.length;
    yield header;
  }
  assertWithinZip32(centralOffset + centralSize, "压缩包");

  yield endOfCentralDirectory(records.length, centralSize, centralOffset);
}
