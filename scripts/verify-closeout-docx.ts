import "dotenv/config";
import { inflateRawSync } from "node:zlib";
import { prisma } from "../lib/db";
import { buildCloseoutDocument } from "../lib/export/closeout";
import { buildCloseoutDocx } from "../lib/export/closeout-docx";
import { loadCloseoutInput } from "../lib/export/closeout-sources";

/**
 * 端到端验证结题清单 Word（增量 3.2）：真库 → 装载 → 建模 → 生成 .docx →
 * 解开包读回正文，确认该出现的字确实在文档里。
 *
 * 单测只覆盖到文档模型。**「模型对」不等于「Word 里真有这些字」**——
 * 排版那一层写错一个 children 数组，生成的仍是一个能打开的空文档。
 *
 * 数据库写入放在强制回滚的事务里，跑完不留行。
 */
const ROLLBACK = new Error("VERIFY_CLOSEOUT_ROLLBACK");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * 从 .docx 里取出 word/document.xml 的正文。
 *
 * .docx 就是个 ZIP，条目是 deflate 压缩的（和我们自己写的 store-only 包不同）。
 * 这里只解一个条目，够用就行，不引入解压库。
 */
function readDocumentXml(docx: Buffer): string {
  const eocd = docx.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(eocd > 0, "不是合法的 ZIP：找不到 EOCD");
  const count = docx.readUInt16LE(eocd + 10);
  let cursor = docx.readUInt32LE(eocd + 16);

  for (let i = 0; i < count; i++) {
    assert(docx.readUInt32LE(cursor) === 0x02014b50, `第 ${i + 1} 条中央目录头损坏`);
    const method = docx.readUInt16LE(cursor + 10);
    const compressedSize = docx.readUInt32LE(cursor + 20);
    const nameLength = docx.readUInt16LE(cursor + 28);
    const name = docx.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const localOffset = docx.readUInt32LE(cursor + 42);

    if (name === "word/document.xml") {
      const localNameLength = docx.readUInt16LE(localOffset + 26);
      const localExtraLength = docx.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localNameLength + localExtraLength;
      const bytes = docx.subarray(start, start + compressedSize);
      return method === 0 ? bytes.toString("utf8") : inflateRawSync(bytes).toString("utf8");
    }

    cursor += 46 + nameLength + docx.readUInt16LE(cursor + 30) + docx.readUInt16LE(cursor + 32);
  }
  throw new Error("包里没有 word/document.xml");
}

/** Word 会把一段文字拆进多个 <w:t>，断言前先把标签剥掉 */
function plainText(xml: string): string {
  return xml.replace(/<[^>]+>/g, "");
}

async function main() {
  const before = {
    projects: await prisma.project.count(),
    achievements: await prisma.achievement.count(),
    exportRuns: await prisma.exportRun.count(),
  };

  let findings:
    | {
        bytes: number;
        hasRawText: boolean;
        hasQualified: boolean;
        pendingListedSeparately: boolean;
        materialNumbersMatchZip: boolean;
        completionRate: string;
      }
    | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const project = await tx.project.create({
        data: {
          title: `结题清单集成验证 ${suffix}`,
          code: `VCO-${suffix.slice(0, 8)}`,
          status: "CLOSING",
        },
        select: { id: true },
      });

      const rawText = "公开发表与本课题相关的学术论文 1 篇，本人须为第一作者。";
      const requirement = await tx.requirement.create({
        data: { projectId: project.id, rawText, requiredCount: 1, allowedTypes: [] },
        select: { id: true },
      });

      const qualified = await tx.achievement.create({
        data: {
          type: "PAPER",
          title: `已达标的论文 ${suffix}`,
          tags: [],
          usableFor: [],
          datePrecision: "MONTH",
          publishedAt: new Date(Date.UTC(2026, 5, 1)),
        },
        select: { id: true },
      });
      const pending = await tx.achievement.create({
        data: { type: "PAPER", title: `在办的论文 ${suffix}`, tags: [], usableFor: [] },
        select: { id: true },
      });

      await tx.requirementLink.create({
        data: {
          requirementId: requirement.id,
          achievementId: qualified.id,
          isQualified: true,
          qualifyNote: "已见刊",
        },
      });
      await tx.requirementLink.create({
        data: { requirementId: requirement.id, achievementId: pending.id, isQualified: false },
      });

      const attachment = await tx.attachment.create({
        data: {
          projectId: project.id,
          kind: "FINAL_REPORT",
          code: "1-1",
          filename: "结项报告.docx",
          storagePath: `verify-closeout/${crypto.randomUUID()}`,
          size: 1,
          mimeType: "application/octet-stream",
        },
        select: { id: true },
      });
      await tx.requirementAttachment.create({
        data: { requirementId: requirement.id, attachmentId: attachment.id },
      });

      const input = await loadCloseoutInput(project.id, new Date(), tx as typeof prisma);
      assert(input, "装载不到结题清单输入");

      const document = buildCloseoutDocument(input);
      const docx = await buildCloseoutDocx(document);
      const body = plainText(readDocumentXml(docx));

      findings = {
        bytes: docx.byteLength,
        hasRawText: body.includes(rawText),
        hasQualified: body.includes(`已达标的论文 ${suffix}`),
        // 在办的那条必须出现在文档里，但要在「尚未确认达标」那一栏
        pendingListedSeparately:
          body.includes(`在办的论文 ${suffix}`) && body.includes("已挂接、尚未确认达标"),
        // 清单里的编号必须和 ZIP 条目名的第一段一致。
        // materialIndex 与 materialPlan.entries 一一对应且同序，直接逐位比。
        // 要求项下引用的那几条走的是另一条路（按 attachmentId 查表），一并核对
        materialNumbersMatchZip:
          document.materialIndex.length === input.materialPlan.entries.length &&
          document.materialIndex.every((material, index) =>
            input.materialPlan.entries[index].name.startsWith(`${material.no}_`),
          ) &&
          document.requirements.every((section) =>
            section.materials.every((material) =>
              input.materialPlan.entries.some(
                (entry) => entry.no === material.no && entry.filename === material.filename,
              ),
            ),
          ),
        completionRate: document.summary.completionRate,
      };

      assert(findings.hasRawText, "要求原文没有出现在生成的 Word 里");
      assert(findings.hasQualified, "已确认达标的成果没有出现在生成的 Word 里");
      assert(findings.pendingListedSeparately, "在办成果没有被单独列出");
      assert(findings.materialNumbersMatchZip, "清单里的材料编号和 ZIP 条目对不上");
      assert(findings.completionRate === "100%", `完成度应为 100%，实际 ${findings.completionRate}`);

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  assert(findings, "集成验证没有跑完");

  const after = {
    projects: await prisma.project.count(),
    achievements: await prisma.achievement.count(),
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
