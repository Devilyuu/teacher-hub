"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { semesterFormSchema } from "@/lib/schemas/semester";
import { requireSession } from "@/lib/server-auth";

/** 学期改动同时影响设置页列表和首页问候行的教学周 */
function revalidateSemester() {
  revalidatePath("/settings");
  revalidatePath("/");
}

export async function createSemester(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = semesterFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  // 重名走前置检查而不是解析 P2002：单人系统没有并发写，
  // 竞态窗口只在理论上存在，为它写一套约束元数据解析不值得
  const existing = await prisma.semester.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经设过了` };
  }

  await prisma.semester.create({ data: parsed.data });
  revalidateSemester();
  return { ...IDLE_FORM_STATE, ok: true, message: "已设置" };
}

/** 硬删。学期只是显示锚点，没有任何记录挂在它上面，删错了重设一条就是 */
export async function deleteSemester(id: string) {
  await requireSession();
  await prisma.semester.delete({ where: { id } });
  revalidateSemester();
}
