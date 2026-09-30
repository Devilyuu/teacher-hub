import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { achievementFormSchema, achievementQuickEditSchema } from "./achievement";
import {
  captureFormSchema,
  captureMenteeRecordSchema,
  captureSnoozeSchema,
  captureStudentRecordSchema,
} from "./capture";
import {
  competitionEntryFormSchema,
  competitionFormSchema,
  competitionMembersSchema,
} from "./competition";
import { linkFormSchema, qualifyFormSchema, requirementFormSchema } from "./link";
import {
  materialLinkFormSchema,
  materialQualificationFormSchema,
  requirementReportUploadFormSchema,
} from "./material";
import { meetingFormSchema, resolutionFormSchema } from "./meeting";
import {
  menteeBatchFormSchema,
  menteeBulkImportSchema,
  menteeFormSchema,
  menteeMilestoneFormSchema,
  menteeProjectFormSchema,
  menteeProjectKindFormSchema,
  menteeRecordFormSchema,
  menteeRecordTypeFormSchema,
} from "./mentee";
import { docCategoryCreateSchema, personalDocumentUploadSchema } from "./personal-document";
import { profileFormSchema } from "./profile";
import { optionalText, projectFormSchema } from "./project";
import { projectPerformanceFormSchema } from "./project-performance";
import {
  pastedRulesFormSchema,
  perfCategoryFormSchema,
  promotionCategoryFormSchema,
  ruleGroupFormSchema,
  rulesetHeadFormSchema,
} from "./rules";
import { schoolRewardFormSchema } from "./school-reward";
import { semesterFormSchema } from "./semester";
import {
  bulkImportSchema,
  checklistFormSchema,
  classGroupFormSchema,
  honorFormSchema,
  recordFormSchema,
  recordTypeFormSchema,
  relationFormSchema,
  studentFormSchema,
} from "./student";
import { recurringRuleFormSchema, taskFormSchema } from "./task";
import { adoptTeachingImportSchema } from "./teaching-import";
import { timetableSlotFormSchema } from "./timetable";

/**
 * 表单 ↔ schema 契约：schema 里**不许缺席**的键，对应的表单源码里必须有 `name="那个键"`。
 *
 * 2026-09-24 线上 bug 就是这一类：导师模块建批次的 schema 收 `note`，表单里没有备注框。
 * `optionalText` 允许空串、**不允许键缺席**，于是每一次都校验失败，从上线起没人建成过批次；
 * 单测多喂了一个 `note: ""` 正好把它盖住（CLAUDE.md 代码约定）。
 * 这里不喂任何数据，直接拿 schema 的「必须出现的键」去对表单源码里的 `name=`，
 * 不依赖写测试的人记得「只喂表单真会提交的键」。
 *
 * 局限写在明处：它查的是「源码里有没有这个 name」，**不管这个字段是不是在所有分支都渲染**
 * （09-24 第二处——批次里没项目时下拉不渲染——它抓不到，那种要么 schema 允许缺席，
 * 要么另一分支补同名 hidden input）。新增表单时在 CONTRACTS 里加一行。
 */

type AnySchema = z.ZodType;

/** ZodObject 本身，或者 `.transform()` 之后的 pipe 的输入端 */
function shapeOf(schema: AnySchema): Record<string, AnySchema> {
  const def = (schema as unknown as { _zod: { def: { shape?: unknown; in?: AnySchema } } })._zod.def;
  if (def.shape) return def.shape as Record<string, AnySchema>;
  if (def.in) return shapeOf(def.in);
  throw new Error("不是 object schema");
}

/** 键缺席（FormData 里根本没有这一项）时会校验失败的那些键 */
function requiredKeys(schema: AnySchema): string[] {
  return Object.entries(shapeOf(schema))
    .filter(([, field]) => !field.safeParse(undefined).success)
    .map(([key]) => key);
}

/** 表单里写了 `name="key"`，或者客户端代码自己拼 FormData 时 `.set("key", …)` / `.append("key", …)` */
function hasField(source: string, key: string): boolean {
  return (
    new RegExp(`name=(?:"${key}"|'${key}'|\\{"${key}"\\}|\\{'${key}'\\}|\\{\`${key}\`\\})`).test(source) ||
    new RegExp(`\\.(?:set|append)\\(\\s*["'\`]${key}["'\`]`).test(source)
  );
}

const read = (file: string) => readFileSync(file, "utf8");

type Contract = {
  label: string;
  schema: AnySchema;
  /** 渲染这个表单字段的文件（含共用的字段组件） */
  files: string[];
};

const APP = "app/(app)";
const CONTRACTS: Contract[] = [
  // ── 成果 / 科研 ──
  { label: "成果表单（新建、编辑共用）", schema: achievementFormSchema, files: [`${APP}/achievements/achievement-form.tsx`] },
  { label: "成果行内订正", schema: achievementQuickEditSchema, files: [`${APP}/achievements/quick-edit-row.tsx`] },
  { label: "课题表单（新建、编辑共用）", schema: projectFormSchema, files: [`${APP}/projects/new/project-form.tsx`] },
  { label: "课题绩效事项", schema: projectPerformanceFormSchema, files: [`${APP}/projects/[id]/project-performance-panel.tsx`] },
  { label: "结题要求项", schema: requirementFormSchema, files: [`${APP}/projects/[id]/requirement-editor.tsx`] },
  { label: "挂接成果", schema: linkFormSchema, files: [`${APP}/projects/[id]/link-controls.tsx`] },
  { label: "勾达标", schema: qualifyFormSchema, files: [`${APP}/projects/[id]/link-controls.tsx`] },
  { label: "关联课题材料", schema: materialLinkFormSchema, files: [`${APP}/projects/[id]/link-controls.tsx`] },
  { label: "材料勾达标", schema: materialQualificationFormSchema, files: [`${APP}/projects/[id]/link-controls.tsx`] },
  { label: "上传结题报告", schema: requirementReportUploadFormSchema, files: [`${APP}/projects/[id]/link-controls.tsx`] },
  { label: "学校奖励审定", schema: schoolRewardFormSchema, files: ["components/school-reward-panel.tsx"] },
  // ── 日常 ──
  { label: "任务", schema: taskFormSchema, files: [`${APP}/tasks/task-form.tsx`] },
  { label: "周期任务规则", schema: recurringRuleFormSchema, files: [`${APP}/tasks/recurring/recurring-panel.tsx`] },
  { label: "新建会议", schema: meetingFormSchema, files: [`${APP}/meetings/meeting-list.tsx`] },
  { label: "会议决议", schema: resolutionFormSchema, files: [`${APP}/meetings/[id]/meeting-detail.tsx`] },
  { label: "速记", schema: captureFormSchema, files: ["components/quick-capture.tsx"] },
  { label: "速记延期", schema: captureSnoozeSchema, files: ["components/capture-inbox.tsx"] },
  { label: "速记归到学生", schema: captureStudentRecordSchema, files: ["components/capture-inbox.tsx"] },
  { label: "速记归到导师学生", schema: captureMenteeRecordSchema, files: ["components/capture-inbox.tsx"] },
  // ── 设置 / 档案 ──
  { label: "档案", schema: profileFormSchema, files: [`${APP}/profile/profile-form.tsx`] },
  { label: "常用文档上传", schema: personalDocumentUploadSchema, files: [`${APP}/profile/document-library.tsx`] },
  { label: "常用文档分类", schema: docCategoryCreateSchema, files: [`${APP}/profile/document-library.tsx`] },
  { label: "学期", schema: semesterFormSchema, files: [`${APP}/settings/semester-panel.tsx`] },
  { label: "手工补课表", schema: timetableSlotFormSchema, files: [`${APP}/settings/timetable/timetable-panel.tsx`] },
  // ── 职称表与绩效表 ──
  { label: "职称指标（新建、编辑共用）", schema: promotionCategoryFormSchema, files: [`${APP}/settings/rules/rules-panel.tsx`] },
  { label: "绩效小类（新建、编辑共用）", schema: perfCategoryFormSchema, files: [`${APP}/settings/rules/rules-panel.tsx`] },
  { label: "整组改名", schema: ruleGroupFormSchema, files: [`${APP}/settings/rules/rules-panel.tsx`] },
  { label: "职称表表头", schema: rulesetHeadFormSchema, files: [`${APP}/settings/rules/rules-panel.tsx`] },
  { label: "粘贴导入规则表", schema: pastedRulesFormSchema, files: [`${APP}/settings/rules/import/import-panel.tsx`] },
  { label: "教案引用为成果", schema: adoptTeachingImportSchema, files: [`${APP}/teaching/teaching-imports.tsx`] },
  // ── 参赛 ──
  { label: "赛事字典", schema: competitionFormSchema, files: [`${APP}/competitions/competition-dict.tsx`] },
  {
    label: "新建参赛",
    schema: competitionEntryFormSchema,
    files: [`${APP}/competitions/new-entry.tsx`, `${APP}/competitions/entry-fields.tsx`],
  },
  {
    label: "编辑参赛",
    schema: competitionEntryFormSchema,
    files: [`${APP}/competitions/[id]/entry-editor.tsx`, `${APP}/competitions/entry-fields.tsx`],
  },
  { label: "参赛学生名单", schema: competitionMembersSchema, files: [`${APP}/competitions/[id]/members-panel.tsx`] },
  // ── 班主任 ──
  { label: "建班", schema: classGroupFormSchema, files: [`${APP}/students/class-empty.tsx`] },
  { label: "新建学生", schema: studentFormSchema, files: [`${APP}/students/roster-panel.tsx`] },
  { label: "编辑学生", schema: studentFormSchema, files: [`${APP}/students/[id]/student-form.tsx`] },
  { label: "学生批量导入", schema: bulkImportSchema, files: [`${APP}/students/roster-panel.tsx`] },
  { label: "矛盾关系", schema: relationFormSchema, files: [`${APP}/students/relations-panel.tsx`] },
  { label: "收缴项", schema: checklistFormSchema, files: [`${APP}/students/checklists/checklist-panel.tsx`] },
  { label: "荣誉（新建、编辑共用）", schema: honorFormSchema, files: [`${APP}/students/honors/honor-form.tsx`] },
  { label: "记录类型", schema: recordTypeFormSchema, files: [`${APP}/students/records/records-panel.tsx`] },
  { label: "学生记录", schema: recordFormSchema, files: [`${APP}/students/records/records-panel.tsx`] },
  // ── 导师（09-24 那个 bug 出在这里）──
  { label: "新建批次", schema: menteeBatchFormSchema, files: [`${APP}/mentees/batch-empty.tsx`] },
  { label: "新建导师学生", schema: menteeFormSchema, files: [`${APP}/mentees/roster-panel.tsx`] },
  { label: "导师学生批量导入", schema: menteeBulkImportSchema, files: [`${APP}/mentees/roster-panel.tsx`] },
  { label: "指导记录类型", schema: menteeRecordTypeFormSchema, files: [`${APP}/mentees/records/records-panel.tsx`] },
  { label: "指导记录", schema: menteeRecordFormSchema, files: [`${APP}/mentees/records/records-panel.tsx`] },
  { label: "项目类型", schema: menteeProjectKindFormSchema, files: [`${APP}/mentees/projects/projects-panel.tsx`] },
  {
    label: "新建学生项目",
    schema: menteeProjectFormSchema,
    files: [`${APP}/mentees/projects/projects-panel.tsx`, `${APP}/mentees/projects/member-picker.tsx`],
  },
  {
    label: "编辑学生项目",
    schema: menteeProjectFormSchema,
    files: [`${APP}/mentees/projects/[id]/project-form.tsx`, `${APP}/mentees/projects/member-picker.tsx`],
  },
  { label: "项目关键节点", schema: menteeMilestoneFormSchema, files: [`${APP}/mentees/projects/[id]/milestones-panel.tsx`] },
];

describe("表单 ↔ schema 契约", () => {
  it.each(CONTRACTS)("$label：schema 不许缺席的键，表单里都有", ({ schema, files }) => {
    const source = files.map(read).join("\n");
    const missing = requiredKeys(schema).filter((key) => !hasField(source, key));
    expect(missing).toEqual([]);
  });

  /** 契约本身要能抓到 09-24 那个 bug，否则上面全绿也说明不了什么 */
  it("能抓到「schema 收了表单里没有的 optionalText 键」", () => {
    const buggy = z.object({ name: z.string().trim().min(1), note: optionalText });
    const form = '<input name="name" /><input name="year" />';
    expect(requiredKeys(buggy).filter((key) => !hasField(form, key))).toEqual(["note"]);
  });

  /** 对着真实表单源码删掉一个字段，契约必须报出来——证明上面那些绿不是对着空气绿的 */
  it.each(CONTRACTS.filter((contract) => requiredKeys(contract.schema).length > 0))(
    "$label：删掉任何一个必收字段都会被抓到",
    ({ schema, files }) => {
      const source = files.map(read).join("\n");
      for (const key of requiredKeys(schema)) {
        const without = source
          .replace(new RegExp(`name=(?:"${key}"|'${key}'|\\{"${key}"\\}|\\{'${key}'\\}|\\{\`${key}\`\\})`, "g"), "")
          .replace(new RegExp(`\\.(?:set|append)\\(\\s*["'\`]${key}["'\`]`, "g"), "");
        expect(hasField(without, key), key).toBe(false);
      }
    },
  );

  it("可以缺席的键（optional、checkbox、带默认值）不算必收", () => {
    const relaxed = z.object({
      title: z.string(),
      note: optionalText.optional(),
      flag: z.literal(["on"]).optional(),
      count: z.coerce.number().default(0),
    });
    expect(requiredKeys(relaxed)).toEqual(["title"]);
  });
});
