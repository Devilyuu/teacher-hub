"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { logActivity } from "@/lib/activity";
import { dedupeRowsByName } from "@/lib/bulk-import";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import { orderProjectMembers } from "@/lib/mentees";
import {
  DEFAULT_MENTEE_PROJECT_KIND_NAMES,
  DEFAULT_MENTEE_RECORD_TYPE_NAMES,
  adoptMenteeProjectAsAchievement,
  attachRecordToProject,
  deleteMenteeWithSoloRecords,
  resolveProjectForBatch,
} from "@/lib/queries/mentees";
import {
  menteeBatchFormSchema,
  menteeBulkImportSchema,
  menteeFormSchema,
  menteeMilestoneFormSchema,
  menteeProjectFormSchema,
  menteeProjectKindFormSchema,
  menteeRecordFormSchema,
  menteeRecordTypeFormSchema,
  parseBulkMentees,
} from "@/lib/schemas/mentee";
import { requireSession } from "@/lib/server-auth";
import { deleteUpload } from "@/lib/storage";

/**
 * 学业导师模块的写入口。铁律在这里的样子：
 * - 只计算不判定：不算「指导次数够不够」，也不给名单上任何人贴红牌
 * - 归属一律拿**库里**的 batchId 复核，不信表单值
 * - 毕业/退出走 active=false 不删——指导记录还挂在名下
 */

function revalidateMentees() {
  revalidatePath("/mentees");
  revalidatePath("/mentees/records");
  revalidatePath("/mentees/projects");
}

// ─── 批次 ────────────────────────────────────────────────────────────

export async function createMenteeBatch(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeBatchFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.menteeBatch.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经建过了` };
  }

  const batchId = await prisma.$transaction(async (tx) => {
    const isFirstBatch = (await tx.menteeBatch.count()) === 0;
    const batch = await tx.menteeBatch.create({ data: parsed.data, select: { id: true } });
    // **只在建第一批时**顺手补齐两张字典（指导记录类型、项目类型）。
    // **不在页面加载时补**——GET 不该写库；也不做成迁移里的 INSERT——
    // 字典可删，删了不该在下次迁移时复活。
    // 为什么要判「第一批」：skipDuplicates 只防重复、不防复活——
    // 用户删掉「生涯规划」后再建一批，它会被原样种回来。以前只能建一个批次，
    // 这件事碰巧不会发生；页头有了「新建批次」之后就会
    if (!isFirstBatch) return batch.id;
    await tx.menteeRecordType.createMany({
      data: DEFAULT_MENTEE_RECORD_TYPE_NAMES.map((name) => ({ name })),
      skipDuplicates: true,
    });
    await tx.menteeProjectKind.createMany({
      data: DEFAULT_MENTEE_PROJECT_KIND_NAMES.map((name, index) => ({
        name,
        sortOrder: index,
      })),
      skipDuplicates: true,
    });
    return batch.id;
  });

  revalidateMentees();
  // 建完直接进新批次的名单。只刷新的话，页头「新建批次」建出来的第二批
  // 不会被选中——页面还停在原来那一批，看上去像没建成
  redirect(`/mentees?batch=${batchId}`);
}

/** 带完一届就归档。不删——整批的指导记录还要留着填材料 */
export async function setMenteeBatchArchived(batchId: string, archived: boolean) {
  await requireSession();
  await prisma.menteeBatch.update({
    where: { id: batchId },
    data: { archivedAt: archived ? new Date() : null },
  });
  revalidateMentees();
}

// ─── 学生 ────────────────────────────────────────────────────────────

export async function createMentee(
  batchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const batch = await prisma.menteeBatch.findUnique({
    where: { id: batchId },
    select: { id: true },
  });
  if (!batch) return { ok: false, message: "批次不存在" };

  await prisma.mentee.create({ data: { ...parsed.data, batchId } });
  revalidateMentees();
  return { ...IDLE_FORM_STATE, ok: true, message: `已添加 ${parsed.data.name}` };
}

export async function updateMentee(
  menteeId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  await prisma.mentee.update({ where: { id: menteeId }, data: parsed.data });
  revalidateMentees();
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/** 毕业 / 退出双选用停用不用删——指导记录还挂在名下 */
export async function setMenteeActive(menteeId: string, active: boolean) {
  await requireSession();
  await prisma.mentee.update({ where: { id: menteeId }, data: { active } });
  revalidateMentees();
}

/**
 * 硬删只留给手误建错的条目，界面上要 confirm。
 *
 * **只提到他一人的指导记录必须一起删，这不是顺手清理。**
 * `MenteeRecord` 没有指向 `Mentee` 的外键，级联的只有成员连接表
 * （`MenteeRecordMember`）——光删学生的话，那些记录会剩下 0 个成员，
 * 而 0 成员在名单页和导出 xlsx 里**都渲染成「全批」**
 * （records-panel.tsx、export/mentee-records/route.ts）。
 * 于是一次一对一谈话悄悄变成全批集体活动，而学期末那张导师工作记录表
 * 正是从这里导出去交的——这是静默的语义损坏，不报错、事后也查不出来。
 *
 * 和别人一起的记录留着，只是不再记着他：那条记录本来就不只是他的事。
 */
export async function deleteMentee(menteeId: string): Promise<FormState> {
  await requireSession();

  const mentee = await prisma.mentee.findUnique({
    where: { id: menteeId },
    select: { name: true },
  });
  if (!mentee) return { ok: false, message: "这名学生已经不在名单里了" };

  const soloCount = await deleteMenteeWithSoloRecords(menteeId);

  revalidateMentees();
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message:
      soloCount > 0
        ? `已删除 ${mentee.name}，连同只提到他一人的 ${soloCount} 条记录`
        : `已删除 ${mentee.name}`,
  };
}

export async function bulkImportMentees(
  batchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeBulkImportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const batch = await prisma.menteeBatch.findUnique({
    where: { id: batchId },
    select: { id: true },
  });
  if (!batch) return { ok: false, message: "批次不存在" };

  const rows = parseBulkMentees(parsed.data.lines);
  if (rows.length === 0) {
    return { ok: false, message: "没解析出任何学生，检查一下每行是不是姓名开头" };
  }

  // 同名跳过而不是报错：双选名单整表重复粘贴是常态，
  // 已在名单里的不该拦住新增的那几个
  const existing = await prisma.mentee.findMany({
    where: { batchId },
    select: { name: true },
  });
  const existingNames = new Set(existing.map((row) => row.name));
  // 两头都要去重（库里已有 + 这一块里出现过），口径只此一份
  const fresh = dedupeRowsByName(rows, existingNames);

  if (fresh.length > 0) {
    await prisma.mentee.createMany({
      data: fresh.map((row) => ({ ...row, batchId })),
    });
  }

  revalidateMentees();
  const skipped = rows.length - fresh.length;
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message:
      skipped > 0
        ? `导入 ${fresh.length} 人，${skipped} 人已在名单里跳过`
        : `导入 ${fresh.length} 人`,
  };
}

// ─── 指导记录 ─────────────────────────────────────────────────────────

export async function createMenteeRecordType(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeRecordTypeFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.menteeRecordType.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经有了` };
  }

  await prisma.menteeRecordType.create({ data: parsed.data });
  revalidatePath("/mentees/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已添加" };
}

export async function deleteMenteeRecordType(typeId: string): Promise<FormState> {
  await requireSession();

  // Restrict 外键会拦，但先数一遍能给出人话
  const used = await prisma.menteeRecord.count({ where: { typeId } });
  if (used > 0) {
    return { ok: false, message: `还有 ${used} 条记录是这个类型，先改掉它们` };
  }

  await prisma.menteeRecordType.delete({ where: { id: typeId } });
  revalidatePath("/mentees/records");
  return { ...IDLE_FORM_STATE, ok: true, message: "已删除" };
}

export async function createMenteeRecord(
  batchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeRecordFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const batch = await prisma.menteeBatch.findUnique({
    where: { id: batchId },
    select: { id: true },
  });
  if (!batch) return { ok: false, message: "批次不存在" };

  const memberIds = formData
    .getAll("mentees")
    .filter((value): value is string => typeof value === "string" && value !== "");
  if (memberIds.length > 0) {
    // 拿库里的 batchId 复核，不信表单：跨批次的成员会让
    // 「这一届的记录」永远筛不干净
    const count = await prisma.mentee.count({
      where: { id: { in: memberIds }, batchId },
    });
    if (count !== memberIds.length) {
      return { ok: false, message: "勾选的学生里有不在这一批的，请刷新后重试" };
    }
  }

  // 挂项目同样拿**库里**的 batchId 复核：跨批次的项目会让
  // 「这个项目的指导记录」里混进别人那届的谈话
  const resolved = await resolveProjectForBatch(parsed.data.projectId, batchId);
  if (!resolved.ok) {
    return { ok: false, message: "这个项目不在这一批里，刷新后重试" };
  }
  const projectId = resolved.projectId;

  const record = await prisma.menteeRecord.create({
    data: {
      batchId,
      typeId: parsed.data.typeId,
      date: parsed.data.date,
      content: parsed.data.content,
      projectId,
      members: { create: memberIds.map((menteeId) => ({ menteeId })) },
    },
    select: { projectId: true },
  });

  revalidatePath("/mentees/records");
  revalidatePath("/mentees");
  if (record.projectId) revalidatePath(`/mentees/projects/${record.projectId}`);
  return { ...IDLE_FORM_STATE, ok: true, message: "已记录" };
}

/**
 * 把一条既有记录挂到项目上 / 摘下来。
 *
 * **需要这个入口**：`projectId` 是答辩季那张「一人一张的毕设指导记录表」
 * 唯一的筛选依据，而随手记下来的那条（尤其从速记归类过来的）多半还没挂。
 * 没有这个动作，那张表就只能靠新建记录时记得选——等于永远漏一半。
 */
export async function setMenteeRecordProject(
  recordId: string,
  rawProjectId: string,
): Promise<FormState> {
  await requireSession();

  const result = await attachRecordToProject(recordId, rawProjectId);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.reason === "record-missing"
          ? "这条记录已经不在了"
          : "这个项目不在这一批里，刷新后重试",
    };
  }

  revalidatePath("/mentees/records");
  // 两边都要刷：从 A 摘下来挂到 B，A 的详情页也得少一条
  for (const id of [result.previousProjectId, result.projectId]) {
    if (id) revalidatePath(`/mentees/projects/${id}`);
  }
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message: result.projectId ? "已挂到项目上" : "已从项目上摘下",
  };
}

export async function deleteMenteeRecord(recordId: string) {
  await requireSession();
  const record = await prisma.menteeRecord.findUnique({
    where: { id: recordId },
    select: { projectId: true },
  });
  await prisma.menteeRecord.delete({ where: { id: recordId } });
  revalidatePath("/mentees/records");
  revalidatePath("/mentees");
  if (record?.projectId) revalidatePath(`/mentees/projects/${record.projectId}`);
}

// ─── 学生项目（M2）─────────────────────────────────────────────────

/**
 * 表单里的学生多选 + 「主责」单选，转成写库用的成员顺序（下标即 orderIndex，0 = 主责）。
 * **不能直接按复选框顺序写**——复选框按姓名排，那样主责就成了编码最小的人，
 * 编辑一次还会把原主责换掉。口径在 `orderProjectMembers`（lib/mentees.ts，有单测）
 */
function projectMemberIdsFromForm(formData: FormData, existing: readonly string[]): string[] {
  const lead = formData.get("lead");
  return orderProjectMembers({
    checked: formData
      .getAll("mentees")
      .filter((value): value is string => typeof value === "string" && value !== ""),
    lead: typeof lead === "string" && lead !== "" ? lead : null,
    existing,
  });
}

/** 勾选的学生必须都在这一批里。拿**库里**的 batchId 复核，不信表单 */
async function assertMembersInBatch(memberIds: string[], batchId: string) {
  if (memberIds.length === 0) return null;
  const count = await prisma.mentee.count({
    where: { id: { in: memberIds }, batchId },
  });
  if (count !== memberIds.length) {
    return { ok: false as const, message: "勾选的学生里有不在这一批的，请刷新后重试" };
  }
  return null;
}

export async function createMenteeProjectKind(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeProjectKindFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.menteeProjectKind.findUnique({
    where: { name: parsed.data.name },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经有了` };
  }

  await prisma.menteeProjectKind.create({ data: parsed.data });
  revalidatePath("/mentees/projects");
  return { ...IDLE_FORM_STATE, ok: true, message: "已添加" };
}

export async function deleteMenteeProjectKind(kindId: string): Promise<FormState> {
  await requireSession();

  // Restrict 外键会拦，但先数一遍能给出人话
  const used = await prisma.menteeProject.count({ where: { kindId } });
  if (used > 0) {
    return { ok: false, message: `还有 ${used} 个项目是这个类型，先改掉它们` };
  }

  await prisma.menteeProjectKind.delete({ where: { id: kindId } });
  revalidatePath("/mentees/projects");
  return { ...IDLE_FORM_STATE, ok: true, message: "已删除" };
}

export async function createMenteeProject(
  batchId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeProjectFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const [batch, kind] = await Promise.all([
    prisma.menteeBatch.findUnique({ where: { id: batchId }, select: { id: true } }),
    prisma.menteeProjectKind.findUnique({
      where: { id: parsed.data.kindId },
      select: { id: true },
    }),
  ]);
  if (!batch) return { ok: false, message: "批次不存在" };
  if (!kind) return { ok: false, message: "项目类型不存在，刷新后重试" };

  const memberIds = projectMemberIdsFromForm(formData, []);
  const invalid = await assertMembersInBatch(memberIds, batchId);
  if (invalid) return invalid;

  await prisma.menteeProject.create({
    data: {
      batchId,
      title: parsed.data.title,
      kindId: parsed.data.kindId,
      schoolYear: parsed.data.schoolYear,
      outcomeText: parsed.data.outcomeText,
      note: parsed.data.note,
      members: {
        create: memberIds.map((menteeId, index) => ({ menteeId, orderIndex: index })),
      },
    },
  });

  revalidateMentees();
  return { ...IDLE_FORM_STATE, ok: true, message: "已创建，点进去排节点、传材料" };
}

export async function updateMenteeProject(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeProjectFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const project = await prisma.menteeProject.findUnique({
    where: { id: projectId },
    select: {
      batchId: true,
      members: { orderBy: { orderIndex: "asc" }, select: { menteeId: true } },
    },
  });
  if (!project) return { ok: false, message: "这个项目已经不在了" };

  const kind = await prisma.menteeProjectKind.findUnique({
    where: { id: parsed.data.kindId },
    select: { id: true },
  });
  if (!kind) return { ok: false, message: "项目类型不存在，刷新后重试" };

  const memberIds = projectMemberIdsFromForm(
    formData,
    project.members.map((member) => member.menteeId),
  );
  const invalid = await assertMembersInBatch(memberIds, project.batchId);
  if (invalid) return invalid;

  await prisma.$transaction(async (tx) => {
    await tx.menteeProject.update({
      where: { id: projectId },
      data: {
        title: parsed.data.title,
        kindId: parsed.data.kindId,
        schoolYear: parsed.data.schoolYear,
        outcomeText: parsed.data.outcomeText,
        note: parsed.data.note,
      },
    });
    // 成员整组替换：diff 省不了几行写入，却要多背一套对齐逻辑（同 updateHonor）
    await tx.menteeProjectMember.deleteMany({ where: { projectId } });
    if (memberIds.length > 0) {
      await tx.menteeProjectMember.createMany({
        data: memberIds.map((menteeId, index) => ({
          projectId,
          menteeId,
          orderIndex: index,
        })),
      });
    }
  });

  revalidateMentees();
  revalidatePath(`/mentees/projects/${projectId}`);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/**
 * 硬删。**材料记录会级联删，但磁盘文件不会**——先取路径，删库后逐个清盘
 * （与荣誉删除同序）。指导记录不删：MenteeRecord.projectId 是 SetNull，
 * 项目没了，谈过的话还在。
 */
export async function deleteMenteeProject(projectId: string): Promise<FormState> {
  await requireSession();

  const project = await prisma.menteeProject.findUnique({
    where: { id: projectId },
    select: {
      title: true,
      achievementId: true,
      attachments: { select: { storagePath: true } },
    },
  });
  if (!project) return { ok: false, message: "这个项目已经不在了" };
  // 已引用的不给删（同参赛）：那条成果还在台账里，项目一没，
  // 「这个优秀毕设是哪个题目、哪几个学生、过程材料在哪」就再也查不到了
  if (project.achievementId) {
    return { ok: false, message: "已引用为成果的项目不能删——台账那条要靠它查来源" };
  }

  await prisma.menteeProject.delete({ where: { id: projectId } });
  for (const attachment of project.attachments) {
    await deleteUpload(attachment.storagePath);
  }

  revalidateMentees();
  return { ...IDLE_FORM_STATE, ok: true, message: `已删除「${project.title}」` };
}

// ─── 引用为成果（M3）────────────────────────────────────────────────

/**
 * 把学生项目引用为一条成果。事务本体在 `adoptMenteeProjectAsAchievement`
 * （lib/queries/mentees.ts，真库脚本验它）；这里只管鉴权、审计和刷新。
 *
 * 结项情况没填不许引用，**但要说清为什么**（同参赛「先填上奖项」）：
 * 台账那条拿它当标题，没有它，核实的人看不出这条成果到底是什么。
 */
export async function adoptMenteeProject(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const projectId = formData.get("projectId");
  if (typeof projectId !== "string" || projectId === "") {
    return { ...IDLE_FORM_STATE, ok: false, message: "参数不全" };
  }

  const result = await adoptMenteeProjectAsAchievement(projectId);
  switch (result.status) {
    case "not-found":
      return { ...IDLE_FORM_STATE, ok: false, message: "这个项目已经不在了" };
    case "no-outcome":
      return {
        ...IDLE_FORM_STATE,
        ok: false,
        message: "先在下面填上结项情况再引用——台账那条拿它当标题",
      };
    case "already-adopted":
      return { ...IDLE_FORM_STATE, ok: true, message: "这个项目已经引用过了" };
    case "adopted":
      break;
  }

  await logActivity(
    "Achievement",
    result.achievementId,
    "achievement.adopted_from_mentee_project",
    { menteeProjectId: projectId },
  );

  revalidatePath(`/mentees/projects/${projectId}`);
  revalidatePath("/mentees/projects");
  revalidatePath("/achievements");
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message: "已引用为成果，去「待核实」补齐分类口径",
  };
}

// ─── 关键节点 ────────────────────────────────────────────────────────
//
// **是记录不是关卡**：没有「完成」标记、没有顺序约束、没有「上一步没过
// 不许下一步」。节点要进月历和首页倒计时，所以这几个动作得 revalidate 那两处。

function revalidateMilestoneSurfaces(projectId: string) {
  revalidatePath(`/mentees/projects/${projectId}`);
  revalidatePath("/mentees/projects");
  revalidatePath("/calendar");
  revalidatePath("/");
}

export async function createMenteeMilestone(
  projectId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeMilestoneFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const project = await prisma.menteeProject.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (!project) return { ok: false, message: "这个项目已经不在了" };

  await prisma.menteeProjectMilestone.create({
    data: {
      projectId,
      label: parsed.data.label,
      date: parsed.data.date,
      note: parsed.data.note,
    },
  });

  revalidateMilestoneSurfaces(projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已添加节点" };
}

export async function updateMenteeMilestone(
  milestoneId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = menteeMilestoneFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const milestone = await prisma.menteeProjectMilestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true },
  });
  if (!milestone) return { ok: false, message: "这个节点已经不在了" };

  await prisma.menteeProjectMilestone.update({
    where: { id: milestoneId },
    data: {
      label: parsed.data.label,
      date: parsed.data.date,
      note: parsed.data.note,
    },
  });

  revalidateMilestoneSurfaces(milestone.projectId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

export async function deleteMenteeMilestone(milestoneId: string) {
  await requireSession();

  const milestone = await prisma.menteeProjectMilestone.findUnique({
    where: { id: milestoneId },
    select: { projectId: true },
  });
  if (!milestone) return;

  await prisma.menteeProjectMilestone.delete({ where: { id: milestoneId } });
  revalidateMilestoneSurfaces(milestone.projectId);
}
