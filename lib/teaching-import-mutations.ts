import "server-only";

import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { AchievementType } from "@/lib/generated/prisma/enums";

/**
 * 教案回流的写事务（规格 §6.6）。
 *
 * 从 Server Action 里抽出来，是为了让真实数据库 verifier 能直接测它——
 * Server Action 带着 `requireSession()`，脚本里没有 cookie 上下文，
 * 测不到就只能在 verifier 里照抄一遍逻辑，而照抄的那份永远不会跟着改。
 * 形状与 `lib/meeting-mutations.ts` 一致。
 */

type TransactionalClient = Pick<PrismaClient, "$transaction" | "teachingImport">;

export type AdoptInput = {
  title: string;
  type: AchievementType;
  year: number;
};

export type AdoptResult =
  | { status: "adopted"; achievementId: string }
  | { status: "already-adopted"; achievementId: string }
  | { status: "not-found" };

/**
 * 引用为成果：建 `Achievement`、把附件改挂过去、回填回流记录。
 *
 * **附件那步的两个字段必须在同一条 UPDATE 里**：先清空 `teachingImportId`
 * 再赋 `achievementId` 会让中间态的归属数变成 0，
 * `Attachment_single_owner` 会当场拒绝整个事务。
 */
export async function adoptTeachingImport(
  client: TransactionalClient,
  importId: string,
  input: AdoptInput,
): Promise<AdoptResult> {
  return client.$transaction(async (tx) => {
    const record = await tx.teachingImport.findUnique({
      where: { id: importId },
      select: { id: true, achievementId: true },
    });
    if (!record) return { status: "not-found" };

    // 幂等：重复提交拿回同一条成果，不建第二条
    if (record.achievementId) {
      return { status: "already-adopted", achievementId: record.achievementId };
    }

    const achievement = await tx.achievement.create({
      data: {
        // 类型由用户选。**不新增 AchievementType.LESSON_PLAN**——那个枚举是
        // 缺口计算口径，加进去会出现在结题要求的类型下拉里（规格 §6.6）
        type: input.type,
        title: input.title,
        year: input.year,
      },
      select: { id: true },
    });

    await tx.attachment.updateMany({
      where: { teachingImportId: importId },
      data: { teachingImportId: null, achievementId: achievement.id },
    });

    await tx.teachingImport.update({
      where: { id: importId },
      data: {
        achievementId: achievement.id,
        status: "ADOPTED",
        handledAt: new Date(),
      },
    });

    return { status: "adopted", achievementId: achievement.id };
  });
}
