import "dotenv/config";
import { prisma } from "../lib/db";
import { checkMaterialLinkable } from "../lib/materials";

/**
 * 数据库集成验证：要求项 ↔ 课题材料关联（规格 6.4）。
 *
 * 单测只能覆盖 checkMaterialLinkable 这个纯函数。**唯一约束和级联删除是库级事实**，
 * 只有真跑一遍 PostgreSQL 才算数——写错一个 @@unique，重复关联会静默插两行，
 * 材料 ZIP 里同一份文件就出现两次。
 *
 * 全部写入放在强制回滚的事务里，跑完库里不留任何行。
 * 改 schema 或迁移后显式运行 `npm run verify:requirement-materials`。
 */
const ROLLBACK = new Error("VERIFY_REQUIREMENT_MATERIALS_ROLLBACK");

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Findings = {
  uniqueViolationCode: string | null;
  cascadeFromRequirement: number;
  cascadeFromAttachment: number;
  crossProjectRejected: string | null;
  achievementEvidenceRejected: string | null;
};

async function main() {
  const before = {
    projects: await prisma.project.count(),
    requirements: await prisma.requirement.count(),
    attachments: await prisma.attachment.count(),
    links: await prisma.requirementAttachment.count(),
  };

  let findings: Findings | undefined;

  try {
    await prisma.$transaction(async (tx) => {
      const suffix = crypto.randomUUID();
      const project = await tx.project.create({
        data: { title: `材料关联集成验证 ${suffix}` },
        select: { id: true },
      });
      const otherProject = await tx.project.create({
        data: { title: `材料关联集成验证-旁证 ${suffix}` },
        select: { id: true },
      });

      const requirement = await tx.requirement.create({
        data: { projectId: project.id, rawText: "集成验证要求项", allowedTypes: [] },
        select: { id: true },
      });

      const material = async (projectId: string | null, achievementId: string | null) =>
        tx.attachment.create({
          data: {
            projectId,
            achievementId,
            kind: "PROCESS_EVIDENCE",
            filename: "集成验证.pdf",
            storagePath: `verify-materials/${crypto.randomUUID()}`,
            size: 1,
            mimeType: "application/pdf",
          },
          select: { id: true, projectId: true },
        });

      const own = await material(project.id, null);
      const foreign = await material(otherProject.id, null);

      // 1. 正常关联
      const createdLink = await tx.requirementAttachment.create({
        data: { requirementId: requirement.id, attachmentId: own.id },
        select: { id: true, isQualified: true },
      });
      assert(createdLink.isQualified === false, "材料关联被自动确认达标");

      const qualifiedLink = await tx.requirementAttachment.update({
        where: { id: createdLink.id },
        data: {
          isQualified: true,
          qualifiedAt: new Date("2026-07-31T00:00:00.000Z"),
          qualifyNote: "人工确认",
        },
        select: { isQualified: true, qualifiedAt: true, qualifyNote: true },
      });
      assert(qualifiedLink.isQualified, "材料人工确认状态没有保存");
      assert(qualifiedLink.qualifiedAt != null, "材料确认时间没有保存");
      assert(qualifiedLink.qualifyNote === "人工确认", "材料确认说明没有保存");

      // 2. 重复关联必须被唯一约束挡住，而不是静默插第二行
      let uniqueViolationCode: string | null = null;
      await tx.$executeRawUnsafe("SAVEPOINT verify_duplicate_material");
      try {
        await tx.requirementAttachment.create({
          data: { requirementId: requirement.id, attachmentId: own.id },
        });
      } catch (error) {
        uniqueViolationCode = (error as { code?: string }).code ?? "UNKNOWN";
      }
      await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT verify_duplicate_material");
      assert(
        uniqueViolationCode === "P2002",
        `重复关联没有被 @@unique 挡住，拿到的错误码是 ${uniqueViolationCode}`,
      );

      // 3. 跨课题材料与成果级证据必须在服务端被拒（规格 6.4 的两条边界）
      const crossProject = checkMaterialLinkable({
        projectId: project.id,
        requirement: { projectId: project.id },
        attachment: { projectId: foreign.projectId },
      });
      assert(!crossProject.ok, "跨课题材料没有被拒绝");

      const achievementEvidence = checkMaterialLinkable({
        projectId: project.id,
        requirement: { projectId: project.id },
        attachment: { projectId: null },
      });
      assert(!achievementEvidence.ok, "成果级证据没有被拒绝");

      // 4. 两侧级联：删要求项、删材料，连接都要跟着走，不留悬挂行
      await tx.requirement.delete({ where: { id: requirement.id } });
      const cascadeFromRequirement = await tx.requirementAttachment.count({
        where: { attachmentId: own.id },
      });

      const requirement2 = await tx.requirement.create({
        data: { projectId: project.id, rawText: "集成验证要求项 2", allowedTypes: [] },
        select: { id: true },
      });
      await tx.requirementAttachment.create({
        data: { requirementId: requirement2.id, attachmentId: own.id },
      });
      await tx.attachment.delete({ where: { id: own.id } });
      const cascadeFromAttachment = await tx.requirementAttachment.count({
        where: { requirementId: requirement2.id },
      });

      findings = {
        uniqueViolationCode,
        cascadeFromRequirement,
        cascadeFromAttachment,
        crossProjectRejected: crossProject.ok ? null : crossProject.reason,
        achievementEvidenceRejected: achievementEvidence.ok ? null : achievementEvidence.reason,
      };

      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  assert(findings, "集成验证没有跑完");
  assert(findings.cascadeFromRequirement === 0, "删要求项后连接行仍在，级联没生效");
  assert(findings.cascadeFromAttachment === 0, "删材料后连接行仍在，级联没生效");

  const after = {
    projects: await prisma.project.count(),
    requirements: await prisma.requirement.count(),
    attachments: await prisma.attachment.count(),
    links: await prisma.requirementAttachment.count(),
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
