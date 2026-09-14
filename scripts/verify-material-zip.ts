import "dotenv/config";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../lib/db";
import { loadProjectMaterialSources } from "../lib/export/material-sources";
import { buildMaterialZipPlan } from "../lib/export/materials-zip";
import { openUploadStream, UPLOAD_ROOT } from "../lib/storage";
import { crc32, zipStream } from "../lib/zip";

/**
 * 端到端验证材料 ZIP（规格 6.4 / 7.4）：真库、真文件、真打包。
 *
 * 单测覆盖了命名、去重和 ZIP 字节结构，但覆盖不到**这三段接在一起**：
 * 查询能不能同时取到两条来源、storagePath 能不能真读出字节、
 * 打出来的中央目录和实际内容对不对得上。
 *
 * 数据库写入放在强制回滚的事务里；磁盘上的探针文件在 finally 里删干净。
 * 改查询、命名或打包器后显式运行 `npm run verify:material-zip`。
 */
const ROLLBACK = new Error("VERIFY_MATERIAL_ZIP_ROLLBACK");
const SCOPE = `verify-material-zip/${crypto.randomUUID()}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type CentralEntry = { name: string; crc: number; size: number };

/** 从尾部解中央目录。**不用现成的解压库**——这里要验的就是我们自己写的字节 */
function readCentralDirectory(zip: Buffer): CentralEntry[] {
  const eocd = zip.length - 22;
  assert(zip.readUInt32LE(eocd) === 0x06054b50, "找不到 EOCD，包不完整");
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);

  const entries: CentralEntry[] = [];
  for (let i = 0; i < count; i++) {
    assert(zip.readUInt32LE(cursor) === 0x02014b50, `第 ${i + 1} 条中央目录头损坏`);
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

async function writeProbeFile(name: string, content: string): Promise<string> {
  const storagePath = `${SCOPE}/${name}`;
  const absolute = resolve(UPLOAD_ROOT, storagePath);
  await mkdir(resolve(UPLOAD_ROOT, SCOPE), { recursive: true });
  await writeFile(absolute, content, "utf8");
  return storagePath;
}

async function main() {
  const before = {
    projects: await prisma.project.count(),
    attachments: await prisma.attachment.count(),
    exportRuns: await prisma.exportRun.count(),
  };

  let findings:
    | {
        entryNames: string[];
        sources: string[];
        sharedAppearances: number;
        crcMatches: boolean;
        totalBytes: number;
      }
    | undefined;

  try {
    // 三份探针文件：课题材料、成果证据、以及一份既是课题材料又被成果引用的
    const proposalPath = await writeProbeFile("proposal.txt", "申报书正文");
    const evidencePath = await writeProbeFile("evidence.txt", "见刊页扫描件");
    const sharedPath = await writeProbeFile("shared.txt", "两条路都指向它");

    await prisma.$transaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const project = await tx.project.create({
        data: { title: `材料 ZIP 集成验证 ${suffix}`, code: `VMZ-${suffix.slice(0, 8)}` },
        select: { id: true },
      });
      const requirement = await tx.requirement.create({
        data: { projectId: project.id, rawText: "集成验证要求项", allowedTypes: [] },
        select: { id: true },
      });
      const achievement = await tx.achievement.create({
        data: {
          type: "PAPER",
          title: `材料 ZIP 集成验证成果 ${suffix}`,
          tags: [],
          usableFor: [],
        },
        select: { id: true },
      });
      await tx.requirementLink.create({
        data: { requirementId: requirement.id, achievementId: achievement.id },
      });

      const attachment = (
        data: Parameters<typeof tx.attachment.create>[0]["data"],
      ) => tx.attachment.create({ data, select: { id: true } });

      await attachment({
        projectId: project.id,
        kind: "PROPOSAL",
        code: "1-1",
        filename: "课题申报书.txt",
        storagePath: proposalPath,
        size: Buffer.byteLength("申报书正文", "utf8"),
        mimeType: "text/plain",
      });
      await attachment({
        achievementId: achievement.id,
        kind: "PUBLICATION",
        code: "2-1",
        filename: "见刊页.txt",
        storagePath: evidencePath,
        size: Buffer.byteLength("见刊页扫描件", "utf8"),
        mimeType: "text/plain",
      });
      // 关键用例：既是课题材料、又通过挂接的成果能到达。必须只进包一次
      const shared = await attachment({
        projectId: project.id,
        kind: "FINAL_REPORT",
        code: "1-2",
        filename: "结项报告.txt",
        storagePath: sharedPath,
        size: Buffer.byteLength("两条路都指向它", "utf8"),
        mimeType: "text/plain",
      });

      const sources = await loadProjectMaterialSources(project.id, tx as typeof prisma);
      assert(sources, "装载不到课题材料来源");

      // 把共用那份也塞进成果证据列表，模拟两条路同时命中同一个 attachment
      const plan = buildMaterialZipPlan({
        projectMaterials: sources.projectMaterials,
        achievementEvidence: [
          ...sources.achievementEvidence,
          ...sources.projectMaterials.filter((a) => a.id === shared.id),
        ],
        selectedIds: null,
      });

      const chunks: Buffer[] = [];
      for await (const chunk of zipStream(
        plan.entries.map((entry) => ({
          name: entry.name,
          mtime: entry.uploadedAt,
          read: openUploadStream(entry.storagePath),
        })),
      )) {
        chunks.push(chunk);
      }
      const zip = Buffer.concat(chunks);
      const central = readCentralDirectory(zip);

      assert(
        central.length === plan.entries.length,
        `中央目录 ${central.length} 条，规划 ${plan.entries.length} 条，对不上`,
      );

      const expectedCrc: Record<string, number> = {
        "1-1_申报书_课题申报书.txt": crc32(Buffer.from("申报书正文", "utf8")),
        "1-2_结题报告_结项报告.txt": crc32(Buffer.from("两条路都指向它", "utf8")),
        "2-1_见刊页_见刊页.txt": crc32(Buffer.from("见刊页扫描件", "utf8")),
      };
      const crcMatches = central.every((entry) => expectedCrc[entry.name] === entry.crc);

      findings = {
        entryNames: central.map((entry) => entry.name),
        sources: plan.entries.map((entry) => entry.source),
        sharedAppearances: plan.entries.filter((entry) => entry.attachmentId === shared.id).length,
        crcMatches,
        totalBytes: plan.totalBytes,
      };

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  } finally {
    await rm(resolve(UPLOAD_ROOT, SCOPE), { recursive: true, force: true });
  }

  assert(findings, "集成验证没有跑完");
  assert(findings.sharedAppearances === 1, "共用附件进包不止一次，去重失效");
  assert(findings.crcMatches, "包里的 CRC 和文件真实内容对不上");
  assert(
    findings.sources.join(",") === "PROJECT,PROJECT,ACHIEVEMENT",
    `来源次序应为课题材料在前，实际是 ${findings.sources.join(",")}`,
  );

  const after = {
    projects: await prisma.project.count(),
    attachments: await prisma.attachment.count(),
    exportRuns: await prisma.exportRun.count(),
  };
  const rowsLeftBehind = Object.fromEntries(
    Object.keys(before).map((key) => [
      key,
      after[key as keyof typeof after] - before[key as keyof typeof before],
    ]),
  );
  for (const [table, delta] of Object.entries(rowsLeftBehind)) {
    assert(delta === 0, `回滚没生效，${table} 多出 ${delta} 行`);
  }

  console.log(JSON.stringify({ ...findings, rowsLeftBehind }));
}

main()
  .finally(() => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
