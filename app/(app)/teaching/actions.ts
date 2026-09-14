"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { adoptTeachingImportSchema } from "@/lib/schemas/teaching-import";
import { requireSession } from "@/lib/server-auth";
import { adoptTeachingImport as adoptTeachingImportRecord } from "@/lib/teaching-import-mutations";
import type { AchievementType } from "@/lib/generated/prisma/enums";

/**
 * 教案回流的处理动作（规格 §6.6、§7.6）。
 *
 * 回流记录本身由外部接口写入（`app/api/teaching/import/route.ts`），
 * 这里只处理**用户的决定**：引用为成果、忽略、或者把忽略撤回来。
 */

/**
 * 引用为成果。
 *
 * **这是教案进入台账的唯一路径**——系统永远不会自己走这一步（第 1 条铁律）。
 *
 * 三件事必须在同一个事务里：建 `Achievement`、把附件从 `teachingImportId`
 * 改挂到 `achievementId`、回填 `TeachingImport`。附件那步尤其要注意：
 * 两个字段的变更必须在**同一条 UPDATE** 里，中途只清空一个会让归属数变成 0 或 2，
 * 被 `Attachment_single_owner` 当场拒绝。
 */
export async function adoptTeachingImport(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = adoptTeachingImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { importId, title, type, year } = parsed.data;

  const result = await adoptTeachingImportRecord(prisma, importId, {
    title,
    type: type as AchievementType,
    year,
  });

  if (result.status === "not-found") {
    return { ...IDLE_FORM_STATE, ok: false, message: "这条回流记录已经不在了" };
  }
  if (result.status === "already-adopted") {
    return { ...IDLE_FORM_STATE, ok: true, message: "这份教案已经引用过了" };
  }

  await logActivity("Achievement", result.achievementId, "achievement.adopted_from_teaching", {
    teachingImportId: importId,
  });

  revalidatePath("/teaching");
  revalidatePath("/achievements");
  return { ...IDLE_FORM_STATE, ok: true, message: "已引用为成果" };
}

/** 忽略。**可撤销**——误点不该是一扇单向门 */
export async function dismissTeachingImport(formData: FormData): Promise<void> {
  await requireSession();

  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId === "") return;

  await prisma.teachingImport.updateMany({
    // 已引用的不能忽略：那条成果已经在台账里了，状态退回去会对不上
    where: { id: importId, achievementId: null },
    data: { status: "DISMISSED", handledAt: new Date() },
  });

  revalidatePath("/teaching");
}

/** 把忽略撤回来 */
export async function restoreTeachingImport(formData: FormData): Promise<void> {
  await requireSession();

  const importId = formData.get("importId");
  if (typeof importId !== "string" || importId === "") return;

  await prisma.teachingImport.updateMany({
    where: { id: importId, status: "DISMISSED" },
    data: { status: "RECEIVED", handledAt: null },
  });

  revalidatePath("/teaching");
}
