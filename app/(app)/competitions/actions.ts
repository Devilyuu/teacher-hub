"use server";

import { revalidatePath } from "next/cache";
import { logActivity } from "@/lib/activity";
import { achievementTitleFor } from "@/lib/competitions";
import { prisma } from "@/lib/db";
import { IDLE_FORM_STATE, toFormState, type FormState } from "@/lib/form-state";
import {
  competitionEntryFormSchema,
  competitionFormSchema,
  competitionMembersSchema,
  parseMemberList,
} from "@/lib/schemas/competition";
import { requireSession } from "@/lib/server-auth";
import { deleteUpload } from "@/lib/storage";

/**
 * 指导参赛模块的写入口。
 *
 * 两条铁律在这里的样子：
 * - **不自动判定**：奖项、指导教师排名、进不进台账，全是人工填人工点
 * - **不自动创建成果**：`adoptCompetitionEntry` 是参赛进台账的唯一路径，
 *   和教案回流同构（第 1 条铁律）
 */

function revalidateCompetitions(entryId?: string) {
  revalidatePath("/competitions");
  if (entryId) revalidatePath(`/competitions/${entryId}`);
}

// ─── 赛事字典 ────────────────────────────────────────────────────────

export async function createCompetition(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = competitionFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const existing = await prisma.competition.findUnique({
    where: { name: parsed.data.name },
    select: { id: true },
  });
  if (existing) {
    return { ...IDLE_FORM_STATE, message: `「${parsed.data.name}」已经建过了` };
  }

  await prisma.competition.create({ data: parsed.data });
  revalidateCompetitions();
  return { ...IDLE_FORM_STATE, ok: true, message: `已添加「${parsed.data.name}」` };
}

/**
 * 删赛事。**只删没有参赛记录的**——库里的外键是 Restrict，
 * 硬删有记录的会抛 P2003；用 deleteMany 加条件，删不掉就是没动，不炸页面
 */
export async function deleteCompetition(formData: FormData): Promise<void> {
  await requireSession();

  const id = formData.get("competitionId");
  if (typeof id !== "string" || id === "") return;

  await prisma.competition.deleteMany({ where: { id, entries: { none: {} } } });
  revalidateCompetitions();
}

// ─── 参赛记录 ────────────────────────────────────────────────────────

type EntryFormData = ReturnType<typeof competitionEntryFormSchema.parse>;

/**
 * 解析「选已有赛事」还是「现场新建」。同 projectFormSchema 里 sourceId 的做法：
 * 字典必须是表（第 12 条），但不能因此逼着用户先去别处建一条再回来。
 */
async function resolveCompetitionId(data: EntryFormData): Promise<string> {
  if (data.competitionId) return data.competitionId;

  const name = data.newCompetitionName as string;
  const existing = await prisma.competition.findUnique({
    where: { name },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.competition.create({
    // 新赛事的默认级别跟着这条记录走——多半是同一档，不对再去字典里改
    data: { name, level: data.level },
    select: { id: true },
  });
  return created.id;
}

/**
 * 表单字段 → 库字段。
 *
 * **日期精度只由「填了哪一格」决定**：精确日期填了就是 DAY，只有原文就是
 * UNKNOWN。不去解析「2026年5月前后」猜精度——猜错就是第 8 条铁律里那种
 * 看起来精确的假数据。
 */
function entryData(data: EntryFormData) {
  return {
    track: data.track,
    year: data.year,
    editionText: data.editionText,
    level: data.level,
    status: data.status,
    registerDeadline: data.registerDeadline,
    competeAt: data.competeAt,
    competeDateText: data.competeDateText,
    competeDatePrecision: (data.competeAt ? "DAY" : "UNKNOWN") as "DAY" | "UNKNOWN",
    award: data.award,
    awardTitle: data.awardTitle,
    awardedAt: data.awardedAt,
    awardDateText: data.awardDateText,
    awardDatePrecision: (data.awardedAt ? "DAY" : "UNKNOWN") as "DAY" | "UNKNOWN",
    myOrder: data.myOrder,
    note: data.note,
  };
}

export async function createCompetitionEntry(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = competitionEntryFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const competitionId = await resolveCompetitionId(parsed.data);
  const created = await prisma.competitionEntry.create({
    data: { ...entryData(parsed.data), competitionId },
    select: { id: true },
  });

  revalidateCompetitions(created.id);
  return { ...IDLE_FORM_STATE, ok: true, message: "已记下这次参赛" };
}

export async function updateCompetitionEntry(
  entryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = competitionEntryFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const competitionId = await resolveCompetitionId(parsed.data);
  await prisma.competitionEntry.update({
    where: { id: entryId },
    data: { ...entryData(parsed.data), competitionId },
  });

  revalidateCompetitions(entryId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存" };
}

/**
 * 删参赛记录。附件行随 Cascade 走，**但磁盘文件不会**——
 * 先取路径，删库后逐个清盘（与荣誉删除同序）。
 *
 * 已经引用为成果的不删：那条成果还在台账里，参赛记录一没，
 * 「这个奖是哪次比赛来的」就永远查不到了。
 */
export async function deleteCompetitionEntry(formData: FormData): Promise<void> {
  await requireSession();

  const entryId = formData.get("entryId");
  if (typeof entryId !== "string" || entryId === "") return;

  const entry = await prisma.competitionEntry.findUnique({
    where: { id: entryId },
    select: {
      achievementId: true,
      attachments: { select: { storagePath: true } },
    },
  });
  if (!entry || entry.achievementId) return;

  await prisma.competitionEntry.delete({ where: { id: entryId } });
  for (const attachment of entry.attachments) {
    await deleteUpload(attachment.storagePath);
  }

  revalidatePath("/competitions");
}

// ─── 队员与指导教师 ──────────────────────────────────────────────────

/**
 * 覆盖式保存队员名单。
 *
 * **按姓名对齐而不是整表推倒重建**：重建会把已经挂上的 `studentId` 一起丢掉，
 * 而那层关联是用户一个个点出来的。名单里还在的留着、没了的删、新来的加。
 */
export async function saveCompetitionMembers(
  entryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const parsed = competitionMembersSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return toFormState(parsed.error);

  const wanted = parseMemberList(parsed.data.members);
  const existing = await prisma.competitionMember.findMany({
    where: { entryId },
    select: { id: true, name: true },
  });
  const byName = new Map(existing.map((row) => [row.name, row.id]));

  await prisma.$transaction(async (tx) => {
    const keep = new Set<string>();
    for (const [index, member] of wanted.entries()) {
      const id = byName.get(member.name);
      if (id) {
        keep.add(id);
        await tx.competitionMember.update({
          where: { id },
          data: { note: member.note, orderIndex: index },
        });
      } else {
        await tx.competitionMember.create({
          data: { entryId, name: member.name, note: member.note, orderIndex: index },
        });
      }
    }
    const removed = existing.filter((row) => !keep.has(row.id)).map((row) => row.id);
    if (removed.length > 0) {
      await tx.competitionMember.deleteMany({ where: { id: { in: removed } } });
    }
  });

  revalidateCompetitions(entryId);
  return { ...IDLE_FORM_STATE, ok: true, message: `已保存 ${wanted.length} 名队员` };
}

/** 把队员挂到在册学生上（班主任模块开着才有这个入口）。传空 = 解除关联 */
export async function linkMemberToStudent(formData: FormData): Promise<void> {
  await requireSession();

  const memberId = formData.get("memberId");
  const studentId = formData.get("studentId");
  const entryId = formData.get("entryId");
  if (typeof memberId !== "string" || memberId === "") return;

  await prisma.competitionMember.updateMany({
    where: { id: memberId },
    data: {
      studentId: typeof studentId === "string" && studentId !== "" ? studentId : null,
    },
  });

  revalidateCompetitions(typeof entryId === "string" ? entryId : undefined);
}

/**
 * 合作指导教师。整组覆盖，次序 = 勾选框在表单里的出现次序。
 * **本人不在这份名单里**——本人的排名是记录上的「我是第几指导」。
 */
export async function saveCompetitionCoaches(
  entryId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const teacherIds = formData
    .getAll("coachIds")
    .filter((value): value is string => typeof value === "string" && value !== "");

  await prisma.$transaction(async (tx) => {
    await tx.competitionCoach.deleteMany({ where: { entryId } });
    for (const [index, teacherId] of teacherIds.entries()) {
      await tx.competitionCoach.create({
        data: { entryId, teacherId, orderIndex: index },
      });
    }
  });

  revalidateCompetitions(entryId);
  return { ...IDLE_FORM_STATE, ok: true, message: "已保存指导教师" };
}

// ─── 引用为成果 ──────────────────────────────────────────────────────

/**
 * 把这次获奖引用为一条成果。
 *
 * **这是参赛进入台账的唯一路径**，系统永远不会自己走这一步（第 1 条铁律）——
 * 参赛按赛季产出，自动入库会把待核实队列淹掉，和教案回流一个道理。
 *
 * 三件事在同一个事务里：建 `Achievement`、把**获奖证书**改挂过去、回填指针。
 * 证书那一步两个字段必须在**同一条 UPDATE** 里：中途只清空一个，归属数会变成
 * 0 或 2，被 `Attachment_single_owner` 当场拒绝整个事务。
 *
 * 通知、报名表这些**留在参赛记录上**——它们是备赛档案不是绩效证据；
 * 证书跟着成果走，因为申报包要用的就是它。
 *
 * 建出来的成果 `isVerified = false`，落进「待核实」等用户补分类口径——
 * 绩效小类和职称指标一概不猜（第 11 条：两套坐标系，不许互推）。
 */
export async function adoptCompetitionEntry(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const entryId = formData.get("entryId");
  if (typeof entryId !== "string" || entryId === "") {
    return { ...IDLE_FORM_STATE, ok: false, message: "参数不全" };
  }

  const entry = await prisma.competitionEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      year: true,
      track: true,
      level: true,
      award: true,
      awardTitle: true,
      awardedAt: true,
      awardDateText: true,
      awardDatePrecision: true,
      myOrder: true,
      achievementId: true,
      competition: { select: { name: true } },
    },
  });
  if (!entry) {
    return { ...IDLE_FORM_STATE, ok: false, message: "这条参赛记录已经不在了" };
  }
  if (entry.achievementId) {
    return { ...IDLE_FORM_STATE, ok: true, message: "这次参赛已经引用过了" };
  }
  if (entry.award == null || entry.award === "NONE") {
    // 挡的不是「没获奖不许记」，是「结果还没填就先进台账」——
    // 台账里冒出一条没有奖项的获奖成果，核实的人看不出该填什么
    return {
      ...IDLE_FORM_STATE,
      ok: false,
      message: "先填上奖项再引用——没有奖项的记录进了台账没法核实",
    };
  }

  const title = achievementTitleFor({
    year: entry.year,
    competitionName: entry.competition.name,
    track: entry.track,
    level: entry.level,
    award: entry.award,
    awardTitle: entry.awardTitle,
  });

  const achievementId = await prisma.$transaction(async (tx) => {
    const achievement = await tx.achievement.create({
      data: {
        type: "STUDENT_ACHIEVEMENT",
        title,
        status: "PUBLISHED",
        level: entry.level,
        year: entry.year,
        declareNature: "RESULT",
        publishedAt: entry.awardedAt,
        dateText: entry.awardDateText,
        datePrecision: entry.awardDatePrecision,
        ownerRole: entry.myOrder != null ? `第${entry.myOrder}指导教师` : null,
        authorPosition: entry.myOrder,
        isVerified: false,
      },
      select: { id: true },
    });

    // 证书跟着成果走。两个字段同一条 UPDATE——分两步会撞 Attachment_single_owner
    await tx.attachment.updateMany({
      where: { competitionEntryId: entry.id, kind: "AWARD_CERTIFICATE" },
      data: { competitionEntryId: null, achievementId: achievement.id },
    });

    await tx.competitionEntry.update({
      where: { id: entry.id },
      data: { achievementId: achievement.id },
    });

    return achievement.id;
  });

  await logActivity(
    "Achievement",
    achievementId,
    "achievement.adopted_from_competition",
    { competitionEntryId: entry.id },
  );

  revalidateCompetitions(entry.id);
  revalidatePath("/achievements");
  return {
    ...IDLE_FORM_STATE,
    ok: true,
    message: "已引用为成果，去「待核实」补齐分类口径",
  };
}
