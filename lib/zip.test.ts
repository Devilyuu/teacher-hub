import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { crc32, toDosDateTime, zipStream, type ZipSource } from "./zip";

const run = promisify(execFile);
const MTIME = new Date(2026, 6, 31, 8, 30, 20);

function source(name: string, content: string | Uint8Array, mtime = MTIME): ZipSource {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return {
    name,
    mtime,
    // 分两块给出去，顺带证明打包器能吃分块的源
    read: async function* () {
      yield bytes.subarray(0, Math.ceil(bytes.length / 2));
      yield bytes.subarray(Math.ceil(bytes.length / 2));
    },
  };
}

async function collect(sources: ZipSource[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of zipStream(sources)) chunks.push(chunk);
  return Buffer.concat(chunks);
}

describe("crc32", () => {
  /** 标准测试向量。算错的话解压工具会报 CRC 错误，而包看起来是好的 */
  it("与标准向量一致", () => {
    expect(crc32(Buffer.from("", "utf8"))).toBe(0);
    expect(crc32(Buffer.from("123456789", "utf8"))).toBe(0xcbf43926);
    expect(crc32(Buffer.from("The quick brown fox jumps over the lazy dog", "utf8"))).toBe(
      0x414fa339,
    );
  });

  it("分块累计和一次算的结果相同", () => {
    const whole = Buffer.from("123456789", "utf8");
    const chunked = crc32(whole.subarray(0, 4), crc32(whole.subarray(0, 0)));
    expect(crc32(whole.subarray(4), chunked)).toBe(crc32(whole));
  });
});

describe("toDosDateTime", () => {
  it("按 DOS 位域打包，秒是 2 秒精度", () => {
    const { time, date } = toDosDateTime(new Date(2026, 6, 31, 8, 30, 21));
    expect(time >> 11).toBe(8);
    expect((time >> 5) & 0x3f).toBe(30);
    expect((time & 0x1f) * 2).toBe(20); // 21 秒落到 20
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(7);
    expect(date & 0x1f).toBe(31);
  });

  /** DOS 纪元从 1980 开始，更早的时间没法表达，夹住而不是让整个包打不出来 */
  it("1980 年以前夹到 1980-01-01", () => {
    expect(toDosDateTime(new Date(1970, 0, 1))).toEqual({ time: 0, date: (1 << 5) | 1 });
  });
});

describe("zipStream 结构", () => {
  it("以本地文件头开始、以 EOCD 结束", async () => {
    const zip = await collect([source("a.txt", "hello")]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(1);
  });

  /** bit 11 不设的话，中文材料名在非中文系统上解出来是乱码 */
  it("置 UTF-8 标志位并按 UTF-8 写文件名", async () => {
    const zip = await collect([source("结题报告.pdf", "x")]);
    expect(zip.readUInt16LE(6) & 0x0800).toBe(0x0800);
    const nameLength = zip.readUInt16LE(26);
    expect(zip.subarray(30, 30 + nameLength).toString("utf8")).toBe("结题报告.pdf");
  });

  it("store 模式：压缩后大小等于原始大小", async () => {
    const zip = await collect([source("a.txt", "hello")]);
    expect(zip.readUInt16LE(8)).toBe(0); // method = 0
    expect(zip.readUInt32LE(18)).toBe(5);
    expect(zip.readUInt32LE(22)).toBe(5);
    expect(zip.readUInt32LE(14)).toBe(crc32(Buffer.from("hello", "utf8")));
  });

  it("空包也是合法 ZIP", async () => {
    const zip = await collect([]);
    expect(zip).toHaveLength(22);
    expect(zip.readUInt32LE(0)).toBe(0x06054b50);
    expect(zip.readUInt16LE(10)).toBe(0);
  });
});

describe("zipStream 安全兜底", () => {
  it("拒绝绝对路径", async () => {
    await expect(collect([source("/etc/passwd", "x")])).rejects.toThrow("绝对路径");
    await expect(collect([source("C:\\Windows\\win.ini", "x")])).rejects.toThrow("绝对路径");
  });

  it("拒绝上级目录穿越", async () => {
    await expect(collect([source("../../.env", "x")])).rejects.toThrow("上级目录");
    await expect(collect([source("a/../../b.txt", "x")])).rejects.toThrow("上级目录");
  });

  it("拒绝空名", async () => {
    await expect(collect([source("", "x")])).rejects.toThrow("为空");
  });

  /**
   * 两遍读到的内容不一致意味着文件正在被改。宁可让下载失败，
   * 也不要给出一个解压时报 CRC 错的包——后者用户要到评审现场才发现。
   */
  it("两遍读到的大小不一致时抛错", async () => {
    let call = 0;
    const flaky: ZipSource = {
      name: "flaky.txt",
      mtime: MTIME,
      read: async function* () {
        call += 1;
        yield Buffer.from(call === 1 ? "12345" : "123");
      },
    };
    await expect(collect([flaky])).rejects.toThrow("大小不一致");
  });
});

/**
 * 从尾部读中央目录，列出条目名和偏移。
 *
 * 为什么不拿 `unzip -l` 的输出断言文件名：**Git Bash 里的 Info-ZIP 不认
 * bit 11**，中文名会按本机代码页解释成乱码——那是解压工具的短板，不是包的问题
 * （同一个包 .NET 的 ZipFile 读出来完全正确，Windows 资源管理器走的就是它）。
 * 自己解一遍中央目录，断言才对着字节而不是对着某个工具的脾气。
 */
function readCentralDirectory(zip: Buffer): Array<{ name: string; crc: number; size: number }> {
  const eocdOffset = zip.length - 22;
  expect(zip.readUInt32LE(eocdOffset)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocdOffset + 10);
  let cursor = zip.readUInt32LE(eocdOffset + 16);

  const entries: Array<{ name: string; crc: number; size: number }> = [];
  for (let i = 0; i < count; i++) {
    expect(zip.readUInt32LE(cursor)).toBe(0x02014b50);
    const nameLength = zip.readUInt16LE(cursor + 28);
    entries.push({
      name: zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"),
      crc: zip.readUInt32LE(cursor + 16),
      size: zip.readUInt32LE(cursor + 24),
    });
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
  return entries;
}

/**
 * 往返验证。
 *
 * 前面那些断言只证明字节按我理解的格式排好了，**不证明别人能解开**。
 * 自己写打包器最大的风险就在这里：中央目录用真解析走一遍（永远跑），
 * CRC 完整性交给系统 unzip 的 -t（有就跑，它对 CRC 的校验和文件名编码无关）。
 */
describe("zipStream 往返", () => {
  it("中央目录能被解析出中文条目名、CRC 与大小", async () => {
    const zip = await collect([
      source("1-1_申报书_课题申报书.txt", "申报书正文"),
      source("1-2_结题报告_结项研究报告.txt", "结题报告正文"),
    ]);

    expect(readCentralDirectory(zip)).toEqual([
      {
        name: "1-1_申报书_课题申报书.txt",
        crc: crc32(Buffer.from("申报书正文", "utf8")),
        size: Buffer.byteLength("申报书正文", "utf8"),
      },
      {
        name: "1-2_结题报告_结项研究报告.txt",
        crc: crc32(Buffer.from("结题报告正文", "utf8")),
        size: Buffer.byteLength("结题报告正文", "utf8"),
      },
    ]);
  });

  it("中央目录记录的偏移指向对应的本地文件头", async () => {
    const zip = await collect([source("a.txt", "aaa"), source("b.txt", "bbbbb")]);
    const eocdOffset = zip.length - 22;
    let cursor = zip.readUInt32LE(eocdOffset + 16);

    for (const expected of ["a.txt", "b.txt"]) {
      const nameLength = zip.readUInt16LE(cursor + 28);
      const localOffset = zip.readUInt32LE(cursor + 42);
      expect(zip.readUInt32LE(localOffset)).toBe(0x04034b50);
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      expect(zip.subarray(localOffset + 30, localOffset + 30 + localNameLength).toString("utf8")).toBe(
        expected,
      );
      cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
    }
  });

  it("系统 unzip 校验 CRC 无错（没装 unzip 时跳过）", async () => {
    const hasUnzip = await run("unzip", ["-v"]).then(
      () => true,
      () => false,
    );
    if (!hasUnzip) {
      expect(hasUnzip).toBe(false);
      return;
    }

    const dir = await mkdtemp(join(tmpdir(), "zip-roundtrip-"));
    try {
      const zipPath = join(dir, "materials.zip");
      await writeFile(zipPath, await collect([source("a.txt", "hello"), source("b.txt", "world")]));

      const { stdout } = await run("unzip", ["-t", zipPath]);
      expect(stdout).toContain("No errors detected");

      const { stdout: extracted } = await run("unzip", ["-p", zipPath, "b.txt"]);
      expect(extracted).toBe("world");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
