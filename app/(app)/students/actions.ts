"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { DEFAULT_RECORD_TYPE_NAMES } from "@/lib/queries/students";
import {
  bulkImportSchema,
  checklistFormSchema,
  classGroupFormSchema,
  honorFormSchema,
  parseBulkStudents,
  recordFormSchema,
  recordTypeFormSchema,
  relationFormSchema,
  studentFormSchema,
} from "@/lib/schemas/student";
import { requireSession } from "@/lib/server-auth";
import { deleteUpload } from "@/lib/storage";

/**
 * 班主任模块的写入口。铁律在这里的样子：
 * - 勾名单只数不判定：交没交永远是人工勾的
 * - 关系、荣誉的归属校验拿**库里**的 classGroupId 复核，不信表单值
 * - 删除都走「先删库再清盘」（与成果删除同序）
 */

function revalidateStudents() {
  revalidatePath("/students");
}

// ─── 班级 ────────────────────────────────────────────────────────────

export async function createClassGroup(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = classGroupFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.classGroup.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经建过了` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.classGroup.create({ data: parsed.data });
    // 建第一个班时顺手补齐记录类型字典（谈话/班会/事件）。
    // skipDuplicates：用户删过的类型不复活，改过名的不重复
    await tx.studentRecordType.createMany({
      data: DEFAULT_RECORD_TYPE_NAMES.map((name) => ({ name })),
      skipDuplicates: true,
    });
  });

  revalidateStudents();
  return { ...IDLE_FORM_STATE, ok: true, message: `已建班「${parsed.data.name}」` };
}

// ─── 学生 ────────────────────────────────────────────────────────────

export async function createStudent(
  classGroupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = studentFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "班级不存在" };

  await prisma.student.create({ data: { ...parsed.data, classGroupId } });
  revalidateStudents();
  return { ...IDLE_FORM_STATE, ok: true, message: `已添加 ${parsed.data.name}` };
}

export async function updateStudent(
  studentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = studentFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  await prisma.student.update({ where: { id: studentId }, data: parsed.data });
  revalidateStudents();
  revalidatePath(`/students/${studentId}`);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/** 离班（退学/转专业/参军）用停用不用删——历史记录还挂在名下 */
export async function setStudentActive(studentId: string, active: boolean) {
  await requireSession();
  await prisma.student.update({ where: { id: studentId }, data: { active } });
  revalidateStudents();
  revalidatePath(`/students/${studentId}`);
}

/** 硬删只留给手误建错的条目；有记录/荣誉的会连着级联删，界面上要 confirm */
export async function deleteStudent(studentId: string): Promise<FormState> {
  await requireSession();

  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: { name: true },
  });
  if (!student) return { ok: false, message: "这名学生已经不在了" };

  await prisma.student.delete({ where: { id: studentId } });
  revalidateStudents();
  return { ...IDLE_FORM_STATE, ok: true, message: `已删除 ${student.name}` };
}

export async function bulkImportStudents(
  classGroupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = bulkImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "班级不存在" };

  const rows = parseBulkStudents(parsed.data.lines);
  if (rows.length === 0) {
    return { ok: false, message: "没解析出任何学生，检查一下每行是不是姓名开头" };
  }

  // 同名跳过而不是报错：粘贴整表重复导入是常态，已在名册里的不该拦住新增的
  const existing = await prisma.student.findMany({
    where: { classGroupId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((row) => row.name));
  const fresh = rows.filter((row) => !existingNames.has(row.name));

  if (fresh.length > 0) {
    await prisma.student.createMany({
      data: fresh.map((row) => ({ ...row, classGroupId })),
    });
  }

  revalidateStudents();
  const skipped = rows.length - fresh.length;
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message:
      skipped > 0
        ? `导入 ${fresh.length} 人，${skipped} 人已在名册里跳过`
        : `导入 ${fresh.length} 人`,
  };
}

// ─── 矛盾关系 ─────────────────────────────────────────────────────────

export async function createStudentRelation(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = relationFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  if (parsed.data.studentAId === parsed.data.studentBId) {
    return { ok: false, message: "得选两个不同的学生" };
  }

  // 无序对钉成一种写法（数据库 CHECK "studentAId" < "studentBId" 兜底）
  const [studentAId, studentBId] = [parsed.data.studentAId, parsed.data.studentBId].sort();

  const students = await prisma.student.findMany({
    where: { id: { in: [studentAId, studentBId] } },
    select: { id: true, classGroupId: true },
  });
  if (students.length !== 2 || students[0].classGroupId !== students[1].classGroupId) {
    return { ok: false, message: "两名学生必须在同一个班" };
  }

  const existing = await prisma.studentRelation.findUnique({
    where: { studentAId_studentBId: { studentAId, studentBId } },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: "这两人之间已经记过一条了，去改那条" };
  }

  await prisma.studentRelation.create({
    data: { studentAId, studentBId, note: parsed.data.note },
  });
  revalidateStudents();
  return { ...IDLE_FORM_STATE, ok: true, message: "已记录" };
}

/** 化解 / 撤销化解。不删——「他俩以前闹过」在重新分组时仍是有用信息 */
export async function toggleRelationResolved(relationId: string, resolved: boolean) {
  await requireSession();
  await prisma.studentRelation.update({
    where: { id: relationId },
    data: { resolvedAt: resolved ? new Date() : null },
  });
  revalidateStudents();
}

export async function deleteStudentRelation(relationId: string) {
  await requireSession();
  await prisma.studentRelation.delete({ where: { id: relationId } });
  revalidateStudents();
}

// ─── 勾名单 ──────────────────────────────────────────────────────────

export async function createChecklist(
  classGroupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = checklistFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "班级不存在" };

  await prisma.rosterChecklist.create({ data: { ...parsed.data, classGroupId } });
  revalidatePath("/students/checklists");
  return { ...IDLE_FORM_STATE, ok: true, message: "已创建，点进去开始勾" };
}

/**
 * 勾 / 取消勾。有行 = 已交。
 * 学生必须在这张单子的班里——跨班的勾会让「未交名单」永远对不上数。
 */
export async function setCheckmark(
  checklistId: string,
  studentId: string,
  checked: boolean,
) {
  await requireSession();

  const [checklist, student] = await Promise.all([
    prisma.rosterChecklist.findUnique({
      where: { id: checklistId },
      select: { classGroupId: true, closedAt: true },
    }),
    prisma.student.findUnique({
      where: { id: studentId },
      select: { classGroupId: true },
    }),
  ]);
  if (!checklist || !student) return;
  if (checklist.classGroupId !== student.classGroupId) return;

  if (checked) {
    await prisma.rosterCheckmark.upsert({
      where: { checklistId_studentId: { checklistId, studentId } },
      update: {},
      create: { checklistId, studentId },
    });
  } else {
    await prisma.rosterCheckmark.deleteMany({ where: { checklistId, studentId } });
  }
  revalidatePath(`/students/checklists/${checklistId}`);
  revalidatePath("/students/checklists");
}

export async function setChecklistClosed(checklistId: string, closed: boolean) {
  await requireSession();
  await prisma.rosterChecklist.update({
    where: { id: checklistId },
    data: { closedAt: closed ? new Date() : null },
  });
  revalidatePath(`/students/checklists/${checklistId}`);
  revalidatePath("/students/checklists");
}

export async function deleteChecklist(checklistId: string) {
  await requireSession();
  await prisma.rosterChecklist.delete({ where: { id: checklistId } });
  revalidatePath("/students/checklists");
}

// ─── 荣誉 ────────────────────────────────────────────────────────────

/** 表单里的学生多选 + 集体开关，转成写库的形状 */
function honorMembersFromForm(formData: FormData): {
  isCollective: boolean;
  memberIds: string[];
} {
  const isCollective = formData.get("isCollective") != null;
  const memberIds = isCollective
    ? []
    : formData
        .getAll("students")
        .filter((value): value is string => typeof value === "string" && value !== "");
  return { isCollective, memberIds };
}

/** awardedAt 有值就是精确到日；只有 dateText 时精度未知，界面显示原文 */
function honorPrecision(awardedAt: Date | null): "DAY" | "UNKNOWN" {
  return awardedAt != null ? "DAY" : "UNKNOWN";
}

export async function createHonor(
  classGroupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = honorFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "班级不存在" };

  const { isCollective, memberIds } = honorMembersFromForm(formData);
  if (memberIds.length > 0) {
    const count = await prisma.student.count({
      where: { id: { in: memberIds }, classGroupId },
    });
    if (count !== memberIds.length) {
      return { ok: false, message: "勾选的学生里有不在本班的，请刷新后重试" };
    }
  }

  await prisma.studentHonor.create({
    data: {
      ...parsed.data,
      classGroupId,
      isCollective,
      datePrecision: honorPrecision(parsed.data.awardedAt),
      members: { create: memberIds.map((studentId) => ({ studentId })) },
    },
  });

  revalidatePath("/students/honors");
  return { ...IDLE_FORM_STATE, ok: true, message: "已记录。奖状照片进详情页挂" };
}

export async function updateHonor(
  honorId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = honorFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const honor = await prisma.studentHonor.findUnique({
    where: { id: honorId },
    select: { classGroupId: true },
  });
  if (!honor) return { ok: false, message: "这条荣誉已经不在了" };

  const { isCollective, memberIds } = honorMembersFromForm(formData);
  if (memberIds.length > 0) {
    const count = await prisma.student.count({
      where: { id: { in: memberIds }, classGroupId: honor.classGroupId },
    });
    if (count !== memberIds.length) {
      return { ok: false, message: "勾选的学生里有不在本班的，请刷新后重试" };
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.studentHonor.update({
      where: { id: honorId },
      data: {
        ...parsed.data,
        isCollective,
        datePrecision: honorPrecision(parsed.data.awardedAt),
      },
    });
    // 成员整组替换：diff 省不了几行写入，却要多背一套对齐逻辑
    await tx.studentHonorMember.deleteMany({ where: { honorId } });
    if (memberIds.length > 0) {
      await tx.studentHonorMember.createMany({
        data: memberIds.map((studentId) => ({ honorId, studentId })),
      });
    }
  });

  revalidatePath("/students/honors");
  revalidatePath(`/students/honors/${honorId}`);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

export async function deleteHonor(honorId: string): Promise<FormState> {
  await requireSession();

  const honor = await prisma.studentHonor.findUnique({
    where: { id: honorId },
    select: {
      title: true,
      // 附件记录级联删，但磁盘文件不会——先取路径，删库后逐个清盘
      attachments: { select: { storagePath: true } },
    },
  });
  if (!honor) return { ok: false, message: "这条荣誉已经不在了" };

  await prisma.studentHonor.delete({ where: { id: honorId } });
  for (const attachment of honor.attachments) {
    await deleteUpload(attachment.storagePath);
  }

  revalidatePath("/students/honors");
  return { ...IDLE_FORM_STATE, ok: true, message: `已删除「${honor.title}」` };
}

// ─── 记录流水 ─────────────────────────────────────────────────────────

export async function createRecordType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = recordTypeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.studentRecordType.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经有了` };
  }

  await prisma.studentRecordType.create({ data: parsed.data });
  revalidatePath("/students/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已添加" };
}

export async function deleteRecordType(typeId: string): Promise<FormState> {
  await requireSession();

  // Restrict 外键会拦，但先数一遍能给出人话
  const used = await prisma.studentRecord.count({ where: { typeId } });
  if (used > 0) {
    return { ok: false, message: `还有 ${used} 条记录是这个类型，先改掉它们` };
  }

  await prisma.studentRecordType.delete({ where: { id: typeId } });
  revalidatePath("/students/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已删除" };
}

export async function createStudentRecord(
  classGroupId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = recordFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true },
  });
  if (!classGroup) return { ok: false, message: "班级不存在" };

  const memberIds = formData
    .getAll("students")
    .filter((value): value is string => typeof value === "string" && value !== "");
  if (memberIds.length > 0) {
    const count = await prisma.student.count({
      where: { id: { in: memberIds }, classGroupId },
    });
    if (count !== memberIds.length) {
      return { ok: false, message: "勾选的学生里有不在本班的，请刷新后重试" };
    }
  }

  await prisma.studentRecord.create({
    data: {
      classGroupId,
      typeId: parsed.data.typeId,
      date: parsed.data.date,
      content: parsed.data.content,
      members: { create: memberIds.map((studentId) => ({ studentId })) },
    },
  });

  revalidatePath("/students/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已记录" };
}

export async function deleteStudentRecord(recordId: string) {
  await requireSession();
  await prisma.studentRecord.delete({ where: { id: recordId } });
  revalidatePath("/students/records");
}
