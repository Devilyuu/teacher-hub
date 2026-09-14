import { z } from "zod";
import { MODULES, type ModuleKey } from "@/lib/modules";
import { checkboxField } from "@/lib/schemas/project";

/**
 * 模块开关表单。键集从注册表派生而不是手抄——加模块时这里不用改。
 * 复选框未勾选时 key 根本不在 FormData 里，所以必须用 checkboxField
 * （lib/schemas/project.ts 的注释里有这个坑的来历）。
 */
export const moduleSettingsSchema = z.object(
  Object.fromEntries(MODULES.map((module) => [module.key, checkboxField])) as Record<
    ModuleKey,
    typeof checkboxField
  >,
);
