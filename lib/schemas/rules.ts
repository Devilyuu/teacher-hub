import { z } from "zod";
import { normalizeLineEndings } from "@/lib/line-endings";
import { checkboxField, optionalText } from "./project";

/**
 * 职称表与绩效表（设置 → 职称表与绩效表）的表单 schema。
 *
 * 上限这类数字**可空、不许负数**：本校以外的表多半不设上限，条件制的表根本不计分。
 * 赋分原文照原样收（只去首尾空白），不解析（CLAUDE.md 第 1 条）。
 */

/**
 * 多行文本（赋分原文、备注、整表说明）：换行统一成 \n。
 * 浏览器提交表单时会把文本框里的换行规范成 \r\n，粘贴导入存的却是 \n——
 * 不统一的话同一段原文改一次就「变了」，重导时预览会把它报成「赋分原文改了」（2026-09-27 实测）
 */
const multilineText = z
  .string()
  .transform((value) => normalizeLineEndings(value).trim())
  .transform((value) => (value === "" ? null : value));

const yearField = z.coerce
  .number({ message: "年度要填数字" })
  .int("年度要填整数")
  .min(2000, "年度不对")
  .max(2100, "年度不对");

/** 空串当没填；填了就得是不太离谱的非负数，最多两位小数（库里是 Decimal(6,2)） */
const optionalCap = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value == null || (Number.isFinite(value) && value >= 0 && value <= 9999), "上限填一个不小于 0 的数")
  .transform((value) => (value == null ? null : Math.round(value * 100) / 100));

export const ruleTableEnum = z.enum(["promotion", "perf"], { message: "不认识的表" });

export const promotionCategoryFormSchema = z.object({
  /** 编辑时有，新建时是空串 */
  id: optionalText,
  year: yearField,
  code: z.string().trim().min(1, "请填编号").max(20, "编号最多 20 个字"),
  majorIndicator: z.string().trim().min(1, "请填一级指标").max(100, "一级指标名太长了"),
  minorIndicator: z.string().trim().min(1, "请填二级指标").max(200, "二级指标名太长了"),
  scoringRule: multilineText,
  remark: multilineText,
  cap: optionalCap,
  capGroup: optionalText,
  projectEligible: checkboxField,
});

export const perfCategoryFormSchema = z.object({
  id: optionalText,
  year: yearField,
  majorCategory: z.string().trim().min(1, "请填大类").max(100, "大类名太长了"),
  minorCategory: z.string().trim().min(1, "请填小类").max(300, "小类名太长了"),
  baseRule: optionalText,
  nationalRule: optionalText,
  provincialRule: optionalText,
  cityRule: optionalText,
  schoolRule: optionalText,
  collegeRule: optionalText,
  remark: multilineText,
  isTeam: checkboxField,
  isDepartmentAssigned: checkboxField,
  isActive: checkboxField,
  projectEligible: checkboxField,
});

/** 一级指标 / 大类整组改名，职称表还能改一级上限（同组各行共用一个数） */
export const ruleGroupFormSchema = z.object({
  table: ruleTableEnum,
  year: yearField,
  oldName: z.string().trim().min(1, "缺少原来的名字"),
  newName: z.string().trim().min(1, "请填名字").max(100, "名字太长了"),
  /** 只有职称表的表单里有这一格 */
  majorCap: optionalCap.optional(),
});

/** 职称表的表头：出处和整表说明（一行一条） */
export const rulesetHeadFormSchema = z.object({
  year: yearField,
  source: z.string().trim().min(1, "请写这张表的出处，比如「某校 2026 年职称评审量化表」").max(300, "出处太长了"),
  generalNotes: z
    .string()
    .transform((value) =>
      value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    ),
});

/** 粘贴导入。`role` 是每一列的角色，按列顺序重复出现（FormData.getAll） */
export const pastedRulesFormSchema = z.object({
  table: ruleTableEnum,
  year: yearField,
  source: optionalText,
  text: z.string().min(1, "先把表格粘贴进来"),
  hasHeader: checkboxField,
  roles: z.array(z.string()).min(1, "先把表格粘贴进来"),
  mode: z.string().optional(),
  planKey: z.string().optional(),
});
