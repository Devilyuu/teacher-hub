"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { dateOnly, formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { readTimetableGrid } from "@/lib/import/timetable-xls";
import { timetableSlotFormSchema } from "@/lib/schemas/timetable";
import { requireSession } from "@/lib/server-auth";
import {
  parseTimetableGrid,
  parseWeeksText,
  type ParsedSlot,
  type SkippedEntry,
} from "@/lib/timetable";

/** 课表改动同时影响设置子页、首页那张卡和月历 */
function revalidateTimetable() {
  revalidatePath("/settings/timetable");
  revalidatePath("/settings");
  revalidatePath("/");
  revalidatePath("/calendar");
}

/** 一份课表导出撑死几十 KB，5MB 已经是十倍余量；再大的多半传错了文件 */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** 预览里的一行。和 ParsedSlot 一样但去掉 weeks 数组，客户端用不着 */
export type TimetablePreviewSlot = Omit<ParsedSlot, "weeks" | "rawText">;

export type TimetablePreview = {
  /** 文件名 + 大小。确认那一步用它核对「还是预览时那个文件」 */
  fileKey: string;
  fileName: string;
  semesterName: string | null;
  /** 表尾写的开学日 YYYY-MM-DD */
  startDate: string | null;
  totalWeeks: number | null;
  teacherName: string | null;
  /** 库里已有同名学期 */
  existing: { id: string; startDate: string } | null;
  /** 库里的开学日和文件里写的不一样。只提示，导入不改学期 */
  startDateMismatch: boolean;
  /** 确认后会被替换掉的现有条目数 */
  replacingCount: number;
  slots: TimetablePreviewSlot[];
  skipped: SkippedEntry[];
  /** 能不能点「确认导入」；不能时 blocker 说明为什么 */
  blocker: string | null;
};

export type TimetableImportState = FormState & { preview?: TimetablePreview };

/**
 * 导入教务系统导出的课表。**两步同一个动作**：
 * 第一次提交只解析、回显预览；带 `mode=confirm` 再提交一次才写库。
 * 文件留在浏览器那个未受控的 `<input type=file>` 里，两次都随表单上来，
 * 服务端不用暂存草稿；用 fileKey 核对两次是同一个文件，换了文件就退回预览。
 *
 * 写库按学期**整表覆盖**：删掉该学期原有全部条目再写入，手工补的也一起没——
 * 课表一学期导一次，为区分来源再做合并规则不值得（schema 注释里写了）。
 * 学期不存在就按表尾的开学日建一条；已存在则只用它，**不改它的开学日**。
 */
export async function importTimetable(
  _prev: TimetableImportState,
  formData: FormData,
): Promise<TimetableImportState> {
  await requireSession();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "先选一个教务系统导出的课表文件（.xls / .xlsx）" };
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: "文件太大了，课表导出通常只有几十 KB，确认选对了文件" };
  }
  if (!/\.xlsx?$/i.test(file.name)) {
    return { ok: false, message: "只认 .xls 或 .xlsx，教务系统「导出」出来的就是" };
  }

  let parsed;
  try {
    parsed = parseTimetableGrid(readTimetableGrid(new Uint8Array(await file.arrayBuffer())));
  } catch (error) {
    const reason = error instanceof Error ? error.message : "读不出内容";
    return { ok: false, message: `没能解析这份文件：${reason}` };
  }

  const semesterName = parsed.semester.name;
  const existing = semesterName
    ? await prisma.semester.findUnique({
        where: { name: semesterName },
        select: { id: true, startDate: true, _count: { select: { timetable: true } } },
      })
    : null;

  const existingStart = existing ? formatDateOnly(existing.startDate) : null;
  const blocker =
    semesterName == null
      ? "文件里没写「XXXX-XXXX学年第X学期」，认不出这是哪个学期的课表"
      : parsed.slots.length === 0
        ? "文件里一节课都没解析出来"
        : existing == null && parsed.semester.startDate == null
          ? `文件里没有开学日。先到设置页把学期「${semesterName}」设好，再回来导`
          : null;

  const preview: TimetablePreview = {
    fileKey: `${file.name}:${file.size}`,
    fileName: file.name,
    semesterName,
    startDate: parsed.semester.startDate,
    totalWeeks: parsed.semester.totalWeeks,
    teacherName: parsed.semester.teacherName,
    existing: existing ? { id: existing.id, startDate: existingStart! } : null,
    startDateMismatch:
      existingStart != null &&
      parsed.semester.startDate != null &&
      existingStart !== parsed.semester.startDate,
    replacingCount: existing?._count.timetable ?? 0,
    slots: parsed.slots.map(({ weeks: _weeks, rawText: _raw, ...rest }) => rest),
    skipped: parsed.skipped,
    blocker,
  };

  const confirming =
    formData.get("mode") === "confirm" && formData.get("fileKey") === preview.fileKey;
  if (!confirming || blocker || !semesterName) {
    return { ...IDLE_FORM_STATE, preview };
  }

  const startDate = parsed.semester.startDate;
  const semesterId = await prisma.$transaction(async (tx) => {
    let id = existing?.id;
    if (!id) {
      const [year, month, day] = startDate!.split("-").map(Number);
      const created = await tx.semester.create({
        data: { name: semesterName, startDate: dateOnly(year!, month!, day!) },
        select: { id: true },
      });
      id = created.id;
    }
    await tx.timetableSlot.deleteMany({ where: { semesterId: id } });
    await tx.timetableSlot.createMany({
      data: parsed.slots.map((slot) => ({ ...slot, semesterId: id })),
    });
    await logActivity(
      "Semester",
      id,
      "timetable.import",
      {
        fileName: file.name,
        slots: parsed.slots.length,
        skipped: parsed.skipped.length,
        replaced: existing?._count.timetable ?? 0,
        semesterCreated: existing == null,
      },
      tx,
    );
    return id;
  });

  revalidateTimetable();
  const created = existing == null ? `，并新建了学期「${semesterName}」` : "";
  return {
    ok: true,
    message: `已导入 ${parsed.slots.length} 条${created}`,
    preview: { ...preview, existing: { id: semesterId, startDate: startDate ?? existingStart ?? "" } },
  };
}

/** 手工补一条。周次原文照存，展开的数组用来判断「本周有没有」 */
export async function addTimetableSlot(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = timetableSlotFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const { semesterId, weeksText, ...rest } = parsed.data;
  const semester = await prisma.semester.findUnique({ where: { id: semesterId }, select: { id: true } });
  if (!semester) return { ok: false, message: "这个学期不存在了，刷新一下" };

  await prisma.timetableSlot.create({
    data: { ...rest, semesterId, weeksText, weeks: parseWeeksText(weeksText) },
  });
  revalidateTimetable();
  return { ok: true, message: "已添加" };
}

export async function deleteTimetableSlot(id: string) {
  await requireSession();
  await prisma.timetableSlot.delete({ where: { id } });
  revalidateTimetable();
}

/** 清空某学期的课表。学期本身留着——它还是首页教学周的锚点 */
export async function clearTimetable(semesterId: string) {
  await requireSession();
  await prisma.timetableSlot.deleteMany({ where: { semesterId } });
  revalidateTimetable();
}
