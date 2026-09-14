"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { toFormState, type FormState } from "@/lib/form-state";
import { MODULES } from "@/lib/modules";
import { moduleSettingsSchema } from "@/lib/schemas/modules";
import { requireSession } from "@/lib/server-auth";

/**
 * 保存模块开关（设置页）。
 *
 * 关闭一个模块只是把它从导航、搜索里隐藏并在直达 URL 上显示提示页；
 * **不删任何数据**，重新勾上一切回来——所以这里不需要确认弹窗那类仪式。
 */
export async function updateModuleSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = moduleSettingsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  await prisma.$transaction(
    MODULES.map((module) =>
      prisma.moduleSetting.upsert({
        where: { key: module.key },
        update: { enabled: parsed.data[module.key] },
        create: { key: module.key, enabled: parsed.data[module.key] },
      }),
    ),
  );

  // 导航在根布局里，整棵树都要重取
  revalidatePath("/", "layout");
  return {
    ok: true,
    message: "已保存。关闭的模块只是不再显示，里面的数据都还在",
  };
}
