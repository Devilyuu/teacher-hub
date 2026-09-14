import { z } from "zod";
import { dateOnlyField, levelEnum, optionalText } from "@/lib/schemas/project";

/**
 * 班主任模块的表单校验。
 *
 * 这里的字段全是「工作痕迹」不是学籍：手机号不校验格式（座机、短号、
 * 带分机的家长电话都真实存在），学号不校验位数——校验挡掉的都是真数据。
 */

// 表单里只有班级名一个框。schema 不收 note——`optionalText` 允许空串，
// 但**不允许键缺席**，表单里没有的字段写进 schema 就是「永远校验失败」
export const classGroupFormSchema = z.object({
  name: z.string().trim().min(1, "请填写班级名").max(64, "班级名太长了"),
});

export const studentFormSchema = z.object({
  name: z.string().trim().min(1, "请填写姓名").max(32, "姓名太长了"),
  studentNo: optionalText,
  phone: optionalText,
  parentName: optionalText,
  parentPhone: optionalText,
  dormRoom: optionalText,
  internshipUnit: optionalText,
  internshipContact: optionalText,
  note: optionalText,
});

/**
 * 批量导入：一行一个学生，制表符或中英文逗号分列，
 * 列序固定「姓名 学号 手机 家长电话 宿舍」，后四列都可缺。
 * 从 Excel 里整块复制粘贴过来天然就是制表符分隔。
 */
export const bulkImportSchema = z.object({
  lines: z.string().trim().min(1, "粘贴名单后再导入"),
});

export type BulkStudentRow = {
  name: string;
  studentNo: string | null;
  phone: string | null;
  parentPhone: string | null;
  dormRoom: string | null;
};

/** 解析粘贴的名单。纯函数，单测在 student.test.ts */
export function parseBulkStudents(lines: string): BulkStudentRow[] {
  return lines
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Excel 粘贴是制表符；手打的名单常用逗号、顿号或连续空格
      const cells = line.split(/\t|,|，|、|\s{2,}/).map((cell) => cell.trim());
      const [name, studentNo, phone, parentPhone, dormRoom] = cells;
      return {
        name: name ?? "",
        studentNo: studentNo || null,
        phone: phone || null,
        parentPhone: parentPhone || null,
        dormRoom: dormRoom || null,
      };
    })
    .filter((row) => row.name.length > 0);
}

export const relationFormSchema = z.object({
  studentAId: z.string().min(1, "请选择学生"),
  studentBId: z.string().min(1, "请选择学生"),
  note: z.string().trim().min(1, "写一句矛盾的情况，日后才对得上号"),
});

export const checklistFormSchema = z.object({
  title: z.string().trim().min(1, "收什么总得写一句").max(120, "太长了"),
  dueDate: dateOnlyField,
  note: optionalText,
});

export const honorFormSchema = z.object({
  title: z.string().trim().min(1, "请填写荣誉名称").max(200, "太长了"),
  level: levelEnum,
  issuer: optionalText,
  /**
   * 获奖日三件套（铁律 8）：精确日期填 awardedAt；
   * 奖状上只有年月/年份就写进 dateText，awardedAt 留空。
   * 不做「必填其一」的硬校验——刚记一条线索时两样都没有是常态
   */
  awardedAt: dateOnlyField,
  dateText: optionalText,
  note: optionalText,
});

// 同上：类型表单只有名字一个框
export const recordTypeFormSchema = z.object({
  name: z.string().trim().min(1, "请填写类型名").max(32, "太长了"),
});

export const recordFormSchema = z.object({
  typeId: z.string().min(1, "请选择类型"),
  date: dateOnlyField.refine((value) => value != null, "请选择日期"),
  content: z.string().trim().min(1, "记录内容不能为空"),
});
