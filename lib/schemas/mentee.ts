import { z } from "zod";
import { dateOnlyField, optionalText } from "@/lib/schemas/project";

/**
 * 学业导师模块的表单校验。
 *
 * 与班主任模块同一条纪律：这里的字段全是「工作痕迹」不是学籍。
 * 手机号不校验格式（座机、短号、带分机的都真实存在），学号不校验位数——
 * **校验挡掉的都是真数据**，而校验永远不阻止保存（第 3 条铁律）。
 */

export const menteeBatchFormSchema = z.object({
  name: z.string().trim().min(1, "给这批学生起个名字").max(64, "名字太长了"),
  /**
   * 入学年份。限一个宽到荒谬的区间只为挡住手滑——
   * 输成「20233」会让届次排序整个乱掉，而那是排序口径不是业务判定
   */
  year: z.coerce
    .number()
    .int("年份得是整数")
    .min(1990, "年份看着不对")
    .max(2100, "年份看着不对"),
  // 不收 note：建批次的表单只有批次名和年份两个框。`optionalText` 允许空串，
  // 但**不允许键缺席**——表单里没有的字段写进 schema 就是「永远校验失败」。
  // 2026-09-24 用户在线上建第一个批次时撞上：提示「看下标红的地方」却没有一格标红，
  // 从上线起就没人能从界面建成过批次（班主任 classGroupFormSchema 踩过同一个坑）
});

export const menteeFormSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(32, "姓名太长了"),
  studentNo: optionalText,
  className: optionalText,
  phone: optionalText,
  note: optionalText,
});

export const menteeRecordTypeFormSchema = z.object({
  name: z.string().trim().min(1, "请填写类型名").max(32, "太长了"),
});

export const menteeRecordFormSchema = z.object({
  typeId: z.string().min(1, "请选择类型"),
  date: dateOnlyField.refine((value) => value != null, "请选择日期"),
  content: z.string().trim().min(1, "记录内容不能为空"),
  /**
   * 围绕哪个项目谈的。**可空**——大量指导跟项目无关（学业、生涯、家里的事）。
   * 挂上了，答辩季那张「一人一张的毕设指导记录表」才筛得出内容；
   * 没挂也不拦着保存（第 3 条铁律）
   *
   * **键可以缺席**：这一批还没有项目时，表单根本不渲染这个下拉。
   * 光用 `optionalText` 的话，新批次里记第一条指导记录就会校验失败
   */
  projectId: optionalText.optional().transform((value) => value ?? null),
});

export const menteeBulkImportSchema = z.object({
  lines: z.string().trim().min(1, "粘贴名单后再导入"),
});

export type BulkMenteeRow = {
  name: string;
  studentNo: string | null;
  className: string | null;
  phone: string | null;
};

/**
 * 解析粘贴的导师名单。纯函数，单测在 mentee.test.ts。
 *
 * 列序固定「姓名 学号 班级 手机」，后三列都可缺。双选结果通常是一张
 * Excel 表，整块复制过来天然就是制表符分隔。
 *
 * **和班主任的 parseBulkStudents 刻意分开写**，不是复制粘贴的懒惰：
 * 两边的列序不同（那边第三列是手机，这边是班级——导师学生跨班，
 * 班级是识别一个人的关键信息，而班主任的学生全在同一个班里，那一列没有意义）。
 * 合成一个带列序参数的通用函数，读的人就得先去查参数才知道第三列是什么。
 */
export function parseBulkMentees(lines: string): BulkMenteeRow[] {
  return lines
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Excel 粘贴是制表符；手打的名单常用逗号、顿号或连续空格
      const cells = line.split(/\t|,|，|、|\s{2,}/).map((cell) => cell.trim());
      const [name, studentNo, className, phone] = cells;
      return {
        name: name ?? "",
        studentNo: studentNo || null,
        className: className || null,
        phone: phone || null,
      };
    })
    .filter((row) => row.name.length > 0);
}

// ─── M2：学生项目 ────────────────────────────────────────────────────

export const menteeProjectKindFormSchema = z.object({
  name: z.string().trim().min(1, "请填写类型名").max(32, "太长了"),
});

export const menteeProjectFormSchema = z.object({
  title: z.string().trim().min(1, "请填写题目").max(200, "题目太长了"),
  kindId: z.string().min(1, "请选择类型"),
  /**
   * 学年**原文**，「2025—2026 学年」。毕设按学年不按自然年，而学年跨年——
   * 不解析成两个数字（第 8 条铁律的同一条：存原文比存推算值诚实）
   */
  schoolYear: optionalText,
  /**
   * 结项 / 完成情况原文。照原样存、照原样显示，引用为成果时拿它当标题。
   * **不设枚举**——「优秀」「联展入选」「答辩通过」不在一套坐标系的刻度上
   */
  outcomeText: optionalText,
  note: optionalText,
});

/**
 * 关键节点。`date` 可空是刻意的：只知道「五月底答辩」就留空、写进 note，
 * **不许硬转成一个看起来精确的假日期**（第 8 条铁律）。
 * 没有「完成」字段——它是记录不是关卡。
 */
export const menteeMilestoneFormSchema = z.object({
  label: z.string().trim().min(1, "写个节点名，如「开题」").max(32, "太长了"),
  date: dateOnlyField,
  note: optionalText,
});

/** 界面上给的建议值。**只是 datalist，不是枚举**——每个专业的节奏不一样 */
export const MILESTONE_SUGGESTIONS = [
  "开题",
  "中期检查",
  "答辩",
  "作品提交",
] as const;
