"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { logActivity } from "@/lib/activity";
import { todayAsDateOnly, formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { buildCatalogPlan } from "@/lib/import/perf-rules";
import { buildPromotionPlan, type CapCheck } from "@/lib/import/promotion-rules";
import {
  PASTE_LIMITS,
  parsePastedTable,
  tableToPerfPack,
  tableToPromotionPack,
  validateRoles,
  type ColumnRole,
} from "@/lib/import/pasted-table";
import { loadExistingPerfRows, loadExistingPromotionRows } from "@/lib/queries/rule-tables";
import { applyPerfPlan, applyPromotionPlan } from "@/lib/rules/apply";
import { detectRulePack } from "@/lib/rules/pack";
import { diffPerf, diffPromotion, type PreviewDiff } from "@/lib/rules/preview";
import {
  pastedRulesFormSchema,
  perfCategoryFormSchema,
  promotionCategoryFormSchema,
  ruleGroupFormSchema,
  rulesetHeadFormSchema,
} from "@/lib/schemas/rules";
import { requireSession } from "@/lib/server-auth";

/**
 * 设置 → 职称表与绩效表 的全部写动作：粘贴导入、规则包导入、单条增改删、整组改名、整表删除。
 *
 * 两种导入都是**同一个动作提交两次**（照课表导入的规矩）：第一次只算、回显预览；
 * 带 `mode=confirm` 和预览时给的那个键再提交一次才写库。键对不上（预览之后表格或列的设置改过、
 * 换了文件）就退回预览，不写。服务端不暂存草稿。
 *
 * 写库只走 lib/rules/apply.ts：只增改、不删，没写的开关保留原值。
 */

type RuleTable = "promotion" | "perf";

/** 分类一动，成果页、课题页、导出页的下拉和口径都跟着变，整站刷新最省心——这是偶尔来一次的设置页 */
function revalidateRules() {
  revalidatePath("/", "layout");
}

export type RuleImportPreview = {
  /** 确认那一步拿它核对「还是预览时那份」：粘贴导入是参数的摘要，规则包是文件名 + 大小 + 内容摘要 */
  key: string;
  table: RuleTable;
  year: number;
  source: string;
  diff: PreviewDiff;
  /** 系统替人做了什么（编了编号、并了续行），照实写出来 */
  notes: string[];
  /** 读的时候有疑问的地方，不挡导入 */
  warnings: string[];
  /** 职称表的封顶校验（本校那种带一级上限、系列总分的表才有） */
  checks: CapCheck[];
  /** 确认写库之后才有：实际新建、改写了几行（活动日志里记的也是它） */
  applied?: { created: number; updated: number };
};

export type RuleImportState = FormState & { preview?: RuleImportPreview };

const FIELD_LABELS: Record<string, string> = {
  code: "编号",
  major_indicator: "一级指标",
  minor_indicator: "二级指标",
  major_cap: "一级上限",
  cap: "本栏上限",
  cap_group: "共用上限组",
  applies_to: "适用系列",
  category: "大类",
  subcategory: "小类",
  year: "年度",
  source: "出处",
  indicators: "指标",
  rules: "规则",
};

/** zod 的报错翻成人话：「第 4 条指标的编号：指标编号不能为空」 */
function describeDocError(error: ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "规则包的格式不对";
  const [head, index] = issue.path;
  const where =
    head === "indicators" && typeof index === "number"
      ? `第 ${index + 1} 条指标`
      : head === "rules" && typeof index === "number"
        ? `第 ${index + 1} 条规则`
        : "";
  const leaf = String(issue.path[issue.path.length - 1] ?? "");
  const field = FIELD_LABELS[leaf] ?? "";
  const reason = /[一-鿿]/.test(issue.message) ? issue.message : `格式不对（${issue.path.join(".") || "整个文件"}）`;
  return `${where}${where && field ? "的" : ""}${field}${where || field ? "：" : ""}${reason}`;
}

type BuiltPlan =
  | ({ kind: "promotion" } & ReturnType<typeof buildPromotionPlan>)
  | ({ kind: "perf"; checks: CapCheck[] } & ReturnType<typeof buildCatalogPlan>);

function buildPlan(table: RuleTable, doc: unknown): { plan: BuiltPlan } | { error: string } {
  try {
    return {
      plan:
        table === "promotion"
          ? { kind: "promotion", ...buildPromotionPlan(doc) }
          : { kind: "perf", ...buildCatalogPlan(doc), checks: [] },
    };
  } catch (error) {
    if (error instanceof ZodError) return { error: describeDocError(error) };
    throw error;
  }
}

async function currentYearOf(table: RuleTable): Promise<number | null> {
  const latest =
    table === "promotion"
      ? await prisma.promotionRuleset.findFirst({ orderBy: { year: "desc" }, select: { year: true } })
      : await prisma.perfCategory.findFirst({ orderBy: { year: "desc" }, select: { year: true } });
  return latest?.year ?? null;
}

/**
 * 两种导入的公共后半段：建计划 → 跟库里比 → 预览；确认时写库。
 * `doc` 是规则包 JSON（粘贴导入先转成了它）。
 */
async function previewOrApply(
  table: RuleTable,
  rawDoc: Record<string, unknown>,
  options: { key: string; confirming: boolean; notes?: string[]; warnings?: string[]; via: "paste" | "pack" },
): Promise<RuleImportState> {
  const doc = { ...rawDoc };
  // 职称表的整表说明和系列总分：文件里没写就沿用库里这一年的，重导一次不该把它们冲掉
  if (table === "promotion" && typeof doc.year === "number") {
    const existingHead = await prisma.promotionRuleset.findUnique({ where: { year: doc.year } });
    if (existingHead) {
      if (doc.generalNotes == null) doc.generalNotes = existingHead.generalNotes;
      const totals = [existingHead.teacherTotal, existingHead.labTotal, existingHead.ideologyTotal, existingHead.eduAdminTotal];
      if (doc.seriesTotals == null && totals.every((value) => value != null)) {
        doc.seriesTotals = {
          teacher: Number(existingHead.teacherTotal),
          lab: Number(existingHead.labTotal),
          ideology: Number(existingHead.ideologyTotal),
          eduAdmin: Number(existingHead.eduAdminTotal),
        };
      }
    }
  }

  const built = buildPlan(table, doc);
  if ("error" in built) return { ok: false, message: built.error };
  const plan = built.plan;

  const year = plan.kind === "promotion" ? plan.head.year : (plan.drafts[0]?.year ?? Number(doc.year));
  const diff =
    plan.kind === "promotion"
      ? diffPromotion(await loadExistingPromotionRows(prisma, year), plan.drafts)
      : diffPerf(await loadExistingPerfRows(prisma, year), plan.drafts);

  const notes = [...(options.notes ?? [])];
  const warnings = [...(options.warnings ?? []), ...plan.warnings];

  const currentYear = await currentYearOf(table);
  if (currentYear != null && year < currentYear) {
    notes.push(`这是 ${year} 版。录入界面仍用当前的 ${currentYear} 版，${year} 版只给按那一年解释的历史成果用`);
  } else if (currentYear != null && year > currentYear) {
    notes.push(`导入后录入界面改用 ${year} 版；${currentYear} 版原样保留，历史成果仍按它解释`);
  }
  // 库里有、这次没有的那几条不在这里提：预览下面有一行可以展开的清单，两处都写就重复了
  // 同名不同编号：多半是这次编号是自动编的、库里那份用的是原表编号，导进去就成了两条
  if (plan.kind === "promotion" && diff.untouched.length > 0) {
    const newNames = new Set(
      diff.rows.filter((row) => row.change === "new").map((row) => row.label.replace(/^\S+\s/, "")),
    );
    const clashes = diff.untouched.filter((row) => newNames.has(row.label.replace(/^\S+\s/, "")));
    if (clashes.length > 0) {
      warnings.push(
        `有 ${clashes.length} 条和库里已有的指标同名、编号不同（如「${clashes[0]!.label}」），导进去会变成两条。` +
          "如果是同一张表，让编号列对上原来的编号再导",
      );
    }
  }

  const source =
    plan.kind === "promotion" ? plan.head.source : typeof doc.source === "string" ? doc.source : "";
  const preview: RuleImportPreview = {
    key: options.key,
    table,
    year,
    source,
    diff,
    notes,
    warnings,
    checks: plan.checks,
  };
  if (!options.confirming) return { ...IDLE_FORM_STATE, preview };

  const result = await prisma.$transaction(async (tx) => {
    const applied =
      plan.kind === "promotion" ? await applyPromotionPlan(tx, plan) : await applyPerfPlan(tx, plan.drafts);
    await logActivity(
      "RuleTable",
      `${table}:${year}`,
      "rules.import",
      { via: options.via, year, ...applied, untouched: diff.untouched.length, warnings: warnings.length },
      tx,
    );
    return applied;
  });

  revalidateRules();
  // 提示用预览里比出来的数：写库那边把没变的也算「更新」，同一份表重导一次会说「更新 24 条」，其实一条没变
  const label = table === "promotion" ? "职称量化表" : "绩效对照表";
  const { counts } = diff;
  const parts = [`新增 ${counts.new} 条`, `更新 ${counts.changed} 条`, counts.same > 0 ? `${counts.same} 条没变` : null];
  return {
    ok: true,
    message: `已导入 ${year} 版${label}：${parts.filter(Boolean).join("，")}`,
    preview: { ...preview, applied: result },
  };
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

/** 粘贴导入。表格是制表符文本（浏览器把剪贴板里的 HTML 表格也转成了这个），列的角色逐列传上来 */
export async function importPastedRules(
  _prev: RuleImportState,
  formData: FormData,
): Promise<RuleImportState> {
  await requireSession();

  const parsed = pastedRulesFormSchema.safeParse({
    table: formData.get("table"),
    year: formData.get("year"),
    source: String(formData.get("source") ?? ""),
    text: String(formData.get("text") ?? ""),
    hasHeader: formData.get("hasHeader") ?? undefined,
    roles: formData.getAll("roles").map(String),
    mode: formData.get("mode") ?? undefined,
    planKey: formData.get("planKey") ?? undefined,
  });
  if (!parsed.success) return toFormState(parsed.error);
  const { table, year, source, text, hasHeader, roles, mode, planKey } = parsed.data;

  if (text.length > PASTE_LIMITS.chars) {
    return { ok: false, message: "粘贴的内容太多了。一张规则表通常几十上百行，确认复制的是那张表" };
  }
  const grid = parsePastedTable(text);
  if (grid.length === 0) return { ok: false, message: "没有读到表格，先把表格粘贴进来" };
  if (grid.length > PASTE_LIMITS.rows) return { ok: false, message: `行数太多了（${grid.length} 行），确认复制的是规则表` };
  const width = grid[0]!.length;
  if (width > PASTE_LIMITS.columns) return { ok: false, message: `列数太多了（${width} 列），确认复制的是规则表` };
  const roleError = validateRoles(table, roles, width);
  if (roleError) return { ok: false, message: roleError };

  const existingSource =
    table === "promotion"
      ? (await prisma.promotionRuleset.findUnique({ where: { year }, select: { source: true } }))?.source
      : null;
  const resolvedSource = source ?? existingSource ?? `粘贴导入（${formatDateOnly(todayAsDateOnly())}）`;
  const options = { hasHeader, year, source: resolvedSource };
  const built =
    table === "promotion"
      ? tableToPromotionPack(grid, roles as ColumnRole[], options)
      : tableToPerfPack(grid, roles as ColumnRole[], options);
  if (built.itemCount === 0) {
    const minor = table === "promotion" ? "二级指标" : "小类";
    return { ok: false, message: `一条也没认出来：看看「${minor}」是不是指到了写着指标名的那一列` };
  }

  const key = digest([table, year, source, text, hasHeader, roles]);
  const stale = mode === "confirm" && planKey !== key;
  const state = await previewOrApply(table, built.doc, {
    key,
    confirming: mode === "confirm" && !stale,
    notes: built.notes,
    warnings: built.warnings,
    via: "paste",
  });
  if (stale && state.preview) {
    return {
      ...state,
      ok: false,
      tone: "warning",
      message: "表格或列的设置在预览之后改过了，这是按现在的内容重新算的预览，看过再确认",
    };
  }
  return state;
}

/** 一份规则包几十 KB，2MB 已是几十倍余量 */
const MAX_PACK_BYTES = 2 * 1024 * 1024;

/** 规则包导入：同事导出的 JSON，或者照 examples/ 手写的。两张表的包都认，看文件内容分 */
export async function importRulePack(
  _prev: RuleImportState,
  formData: FormData,
): Promise<RuleImportState> {
  await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "先选一个规则包文件（.json）" };
  }
  if (file.size > MAX_PACK_BYTES) return { ok: false, message: "文件太大了，规则包通常只有几十 KB，确认选对了文件" };
  if (!/\.json$/i.test(file.name)) return { ok: false, message: "规则包是 .json 文件，同事从「导出规则包」下载的就是" };

  const text = await file.text();
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, message: "文件打不开：不是有效的 JSON。手工改过的话，看看是不是少了逗号或引号" };
  }
  const detected = detectRulePack(value);
  if (detected.table == null) return { ok: false, message: detected.reason };

  const key = `${file.name}:${file.size}:${digest(text).slice(0, 12)}`;
  const mode = formData.get("mode");
  const stale = mode === "confirm" && formData.get("fileKey") !== key;
  const state = await previewOrApply(detected.table, detected.doc as Record<string, unknown>, {
    key,
    confirming: mode === "confirm" && !stale,
    via: "pack",
  });
  if (stale && state.preview) {
    return { ...state, ok: false, tone: "warning", message: "换了文件，这是新文件的预览，看过再确认" };
  }
  return state;
}

// ─── 单条增改删 ─────────────────────────────────────────────────────

export async function savePromotionCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = promotionCategoryFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);
  const { id, year, code, capGroup, projectEligible, majorIndicator, ...fields } = parsed.data;

  const clash = await prisma.promotionCategory.findUnique({
    where: { year_code: { year, code } },
    select: { id: true, minorIndicator: true },
  });
  if (clash && clash.id !== id) {
    const message = `编号 ${code} 在 ${year} 版里已经有了（${clash.minorIndicator}）`;
    return { ok: false, message, fieldErrors: { code: [message] } };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    // 一级上限跟着一级指标走：同组各行共用一个数，改在整组那一栏（saveRuleGroup）
    const sibling = await tx.promotionCategory.findFirst({
      where: { year, majorIndicator, ...(id ? { id: { not: id } } : {}) },
      select: { majorCap: true },
    });
    const data = {
      code,
      majorIndicator,
      ...fields,
      capGroup: capGroup ?? code,
      projectEligible,
      majorCap: sibling?.majorCap ?? null,
    };

    if (id) {
      const before = await tx.promotionCategory.findUnique({
        where: { id },
        select: { year: true, majorCap: true, majorIndicator: true },
      });
      if (!before || before.year !== year) return "missing" as const;
      // 挪进别的组就用那组的一级上限；新起一组就没有上限；没挪就保留自己原来的
      const majorCap = sibling
        ? sibling.majorCap
        : before.majorIndicator === majorIndicator
          ? before.majorCap
          : null;
      const saved = await tx.promotionCategory.update({ where: { id }, data: { ...data, majorCap } });
      await logActivity("PromotionCategory", saved.id, "rules.category.update", { year, code }, tx);
      return "updated" as const;
    }

    await tx.promotionRuleset.upsert({
      where: { year },
      create: { year, source: "手工录入", generalNotes: [] },
      update: {},
    });
    const last = await tx.promotionCategory.aggregate({ where: { year }, _max: { sortOrder: true } });
    const created = await tx.promotionCategory.create({
      data: { year, ...data, appliesTo: [], sortOrder: (last._max.sortOrder ?? 0) + 10 },
    });
    await logActivity("PromotionCategory", created.id, "rules.category.create", { year, code }, tx);
    return "created" as const;
  });

  if (outcome === "missing") return { ok: false, message: "这一项已经不在了，刷新一下" };
  revalidateRules();
  return { ok: true, message: outcome === "created" ? "已添加" : "已保存" };
}

export async function savePerfCategory(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = perfCategoryFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);
  const { id, year, majorCategory, minorCategory, ...fields } = parsed.data;

  const clash = await prisma.perfCategory.findUnique({
    where: { year_majorCategory_minorCategory: { year, majorCategory, minorCategory } },
    select: { id: true },
  });
  if (clash && clash.id !== id) {
    const message = `${year} 版的「${majorCategory}」里已经有「${minorCategory}」了`;
    return { ok: false, message, fieldErrors: { minorCategory: [message] } };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    if (id) {
      const before = await tx.perfCategory.findUnique({ where: { id }, select: { year: true } });
      if (!before || before.year !== year) return "missing" as const;
      await tx.perfCategory.update({ where: { id }, data: { majorCategory, minorCategory, ...fields } });
      await logActivity("PerfCategory", id, "rules.category.update", { year, majorCategory, minorCategory }, tx);
      return "updated" as const;
    }
    const last = await tx.perfCategory.aggregate({ where: { year }, _max: { sortOrder: true } });
    const created = await tx.perfCategory.create({
      data: { year, majorCategory, minorCategory, ...fields, sortOrder: (last._max.sortOrder ?? 0) + 10 },
    });
    await logActivity("PerfCategory", created.id, "rules.category.create", { year, majorCategory, minorCategory }, tx);
    return "created" as const;
  });

  if (outcome === "missing") return { ok: false, message: "这一项已经不在了，刷新一下" };
  revalidateRules();
  return { ok: true, message: outcome === "created" ? "已添加" : "已保存" };
}

/** 一级指标 / 大类整组改名；职称表顺带改一级上限（同组各行共用一个数） */
export async function saveRuleGroup(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = ruleGroupFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);
  const { table, year, oldName, newName, majorCap } = parsed.data;

  if (table === "promotion") {
    const count = await prisma.$transaction(async (tx) => {
      const renamed = await tx.promotionCategory.updateMany({
        where: { year, majorIndicator: oldName },
        data: { majorIndicator: newName },
      });
      if (majorCap !== undefined) {
        await tx.promotionCategory.updateMany({ where: { year, majorIndicator: newName }, data: { majorCap } });
      }
      await logActivity("RuleTable", `promotion:${year}`, "rules.group.update", { oldName, newName, majorCap: majorCap ?? null }, tx);
      return renamed.count;
    });
    if (count === 0) return { ok: false, message: "这个一级指标已经不在了，刷新一下" };
  } else {
    if (newName !== oldName) {
      // 并进一个已有的大类时，两边不能有同名小类（唯一键是 年度 + 大类 + 小类）
      const [moving, staying] = await Promise.all([
        prisma.perfCategory.findMany({ where: { year, majorCategory: oldName }, select: { minorCategory: true } }),
        prisma.perfCategory.findMany({ where: { year, majorCategory: newName }, select: { minorCategory: true } }),
      ]);
      const taken = new Set(staying.map((row) => row.minorCategory));
      const clashes = moving.filter((row) => taken.has(row.minorCategory)).map((row) => row.minorCategory);
      if (clashes.length > 0) {
        return {
          ok: false,
          message: `「${newName}」里已经有同名的小类（${clashes.slice(0, 3).join("、")}），合并前先改掉其中一边`,
        };
      }
    }
    const count = await prisma.$transaction(async (tx) => {
      const renamed = await tx.perfCategory.updateMany({
        where: { year, majorCategory: oldName },
        data: { majorCategory: newName },
      });
      await logActivity("RuleTable", `perf:${year}`, "rules.group.update", { oldName, newName }, tx);
      return renamed.count;
    });
    if (count === 0) return { ok: false, message: "这个大类已经不在了，刷新一下" };
  }

  revalidateRules();
  return { ok: true, message: "已保存" };
}

/** 职称表的表头：出处和整表说明 */
export async function saveRulesetHead(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireSession();
  const parsed = rulesetHeadFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);
  const { year, source, generalNotes } = parsed.data;

  await prisma.$transaction(async (tx) => {
    await tx.promotionRuleset.upsert({
      where: { year },
      create: { year, source, generalNotes },
      update: { source, generalNotes },
    });
    await logActivity("RuleTable", `promotion:${year}`, "rules.head.update", { notes: generalNotes.length }, tx);
  });
  revalidateRules();
  return { ok: true, message: "已保存" };
}

/**
 * 删一条。挂在它上面的成果、课题、课题绩效事项**不删**，只是分类变成空的（外键 SetNull）——
 * 按钮上的确认文案要把这件事和条数写清楚（ConfirmSubmitButton 的规矩）
 */
export async function deletePromotionCategory(id: string): Promise<void> {
  await requireSession();
  await prisma.$transaction(async (tx) => {
    const row = await tx.promotionCategory.findUnique({ where: { id }, select: { year: true, code: true } });
    if (!row) return;
    await tx.promotionCategory.delete({ where: { id } });
    await logActivity("PromotionCategory", id, "rules.category.delete", row, tx);
  });
  revalidateRules();
}

export async function deletePerfCategory(id: string): Promise<void> {
  await requireSession();
  await prisma.$transaction(async (tx) => {
    const row = await tx.perfCategory.findUnique({
      where: { id },
      select: { year: true, majorCategory: true, minorCategory: true },
    });
    if (!row) return;
    await tx.perfCategory.delete({ where: { id } });
    await logActivity("PerfCategory", id, "rules.category.delete", row, tx);
  });
  revalidateRules();
}

/** 整张表的某一年度版本一起删：导错了年度、导错了表时的退路。挂着的记录同样只是清空分类 */
export async function deleteRuleTable(table: RuleTable, year: number): Promise<void> {
  await requireSession();
  if (table !== "promotion" && table !== "perf") return;
  if (!Number.isInteger(year)) return;
  await prisma.$transaction(async (tx) => {
    const removed =
      table === "promotion"
        ? (await tx.promotionCategory.deleteMany({ where: { year } })).count
        : (await tx.perfCategory.deleteMany({ where: { year } })).count;
    if (table === "promotion") await tx.promotionRuleset.deleteMany({ where: { year } });
    await logActivity("RuleTable", `${table}:${year}`, "rules.table.delete", { year, removed }, tx);
  });
  revalidateRules();
}
