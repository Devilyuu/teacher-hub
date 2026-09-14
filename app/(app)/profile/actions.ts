"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { profileFormSchema } from "@/lib/schemas/profile";
import { requireSession } from "@/lib/server-auth";

/**
 * 保存我的档案。全库只有一条，所以是「有就改、没有就建」而不是按 id 更新——
 * 页面第一次打开时库里可能一条都没有。
 */
export async function saveProfile(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();

  const parsed = profileFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.profile.findFirst({ select: { id: true } });
  if (existing) {
    await prisma.profile.update({ where: { id: existing.id }, data: parsed.data });
  } else {
    await prisma.profile.create({ data: parsed.data });
  }

  revalidatePath("/profile");
  revalidatePath("/settings");
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}
