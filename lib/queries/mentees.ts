import "server-only";
import { prisma } from "@/lib/db";
import {
  MENTEE_ADOPT_ATTACHMENT_KINDS,
  menteeAchievementTitle,
  type CaseIndexSource,
} from "@/lib/mentees";

/**
 * 学业导师模块的读取层。页面只消费这里的结果，不各自拼 include——
 * 「名单怎么排、毕业的学生放哪」这类口径只在一处定。
 *
 * 与班主任模块（lib/queries/students.ts）结构同构但**刻意是两份**：
 * 那边挂 classGroupId，这边挂 batchId，合成一份就得两边都带可空列，
 * 结果是关掉任何一个模块都不干净。
 */

/** 批次列表（含归档）。下拉框用 */
export function getMenteeBatches() {
  return prisma.menteeBatch.findMany({
    // 未归档的在前；同组内新的一届在前——带教中的那批才是每天要看的
    orderBy: [{ archivedAt: "asc" }, { year: "desc" }],
    select: {
      id: true,
      name: true,
      year: true,
      archivedAt: true,
      _count: { select: { mentees: true } },
    },
  });
}

/**
 * 解析当前操作的批次：URL 有 ?batch= 按它找，没有取最近一届未归档的。
 * 返回 null = 一个批次都没建，页面进入引导态。
 */
export async function resolveMenteeBatch(batchParam: string | undefined) {
  if (batchParam) {
    const picked = await prisma.menteeBatch.findUnique({
      where: { id: batchParam },
      select: { id: true, name: true, year: true, archivedAt: true },
    });
    if (picked) return picked;
    // 参数指向不存在的批次（书签过期）时静默落回默认批次，别报错——
    // 第 3 条铁律的同一条精神：越界夹回量程内，不 404
  }
  return prisma.menteeBatch.findFirst({
    where: { archivedAt: null },
    orderBy: { year: "desc" },
    select: { id: true, name: true, year: true, archivedAt: true },
  });
}

/** 名单：在带的排前面，各按姓名排 */
export function getMenteeRoster(batchId: string) {
  return prisma.mentee.findMany({
    where: { batchId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      studentNo: true,
      className: true,
      phone: true,
      note: true,
      active: true,
      studentId: true,
      _count: { select: { recordMembers: true } },
      // 最近一次指导是哪天——名单上一眼看出谁好久没见了。
      // **只取不判定**：不算「超过 N 天未联系」那种红牌（第 1 条铁律）
      recordMembers: {
        orderBy: { record: { date: "desc" } },
        take: 1,
        select: { record: { select: { date: true, type: { select: { name: true } } } } },
      },
    },
  });
}

export function getMenteeRecordTypes() {
  return prisma.menteeRecordType.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      note: true,
      _count: { select: { records: true } },
    },
  });
}

/**
 * 记录流水。`filter` 是**筛选**不是权限：留空就是整批。
 * 日期区间用于「筛出这学期的」——学期末那张导师工作记录表就是这么来的。
 */
export function getMenteeRecords(
  batchId: string,
  filter: { menteeId?: string; typeId?: string; from?: Date; to?: Date } = {},
) {
  return prisma.menteeRecord.findMany({
    where: {
      batchId,
      ...(filter.typeId ? { typeId: filter.typeId } : {}),
      ...(filter.menteeId ? { members: { some: { menteeId: filter.menteeId } } } : {}),
      ...(filter.from || filter.to
        ? {
            date: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      content: true,
      projectId: true,
      type: { select: { id: true, name: true } },
      members: { select: { mentee: { select: { id: true, name: true } } } },
    },
  });
}

/**
 * 把一条指导记录挂到项目上 / 摘下来。
 *
 * 放在这里而不是 Server Action 里，理由同 `deleteMenteeWithSoloRecords`：
 * 这段语义必须能在真库上验（`scripts/verify-mentor-module.ts`），
 * 而 Action 一被脚本 import 就会把 Next 的客户端运行时一起拉进来。
 * 鉴权留在 Action，数据语义只此一份。
 *
 * **跨批次必须拒绝**：挂错批次会让「这个项目的指导记录」里混进别人那届的谈话，
 * 而答辩季那张「一人一张的记录表」正是按它筛的——混进去了不报错，只是表错了。
 *
 * 空串/null = 摘下来，**不是校验失败**。
 */
export async function attachRecordToProject(
  recordId: string,
  rawProjectId: string | null | undefined,
): Promise<
  | { ok: true; previousProjectId: string | null; projectId: string | null }
  | { ok: false; reason: "record-missing" | "cross-batch" }
> {
  const record = await prisma.menteeRecord.findUnique({
    where: { id: recordId },
    select: { batchId: true, projectId: true },
  });
  if (!record) return { ok: false, reason: "record-missing" };

  let projectId: string | null = null;
  if (rawProjectId) {
    const project = await prisma.menteeProject.findUnique({
      where: { id: rawProjectId },
      select: { batchId: true },
    });
    if (!project || project.batchId !== record.batchId) {
      return { ok: false, reason: "cross-batch" };
    }
    projectId = rawProjectId;
  }

  await prisma.menteeRecord.update({ where: { id: recordId }, data: { projectId } });
  return { ok: true, previousProjectId: record.projectId, projectId };
}

/** 新建记录时校验项目归属。同上：空串 = 不挂，跨批次返回 null 由调用方拒绝 */
export async function resolveProjectForBatch(
  rawProjectId: string | null | undefined,
  batchId: string,
): Promise<{ ok: true; projectId: string | null } | { ok: false }> {
  if (!rawProjectId) return { ok: true, projectId: null };
  const project = await prisma.menteeProject.findUnique({
    where: { id: rawProjectId },
    select: { batchId: true },
  });
  if (!project || project.batchId !== batchId) return { ok: false };
  return { ok: true, projectId: rawProjectId };
}

/** 记录表单里的项目候选。只要 id 和题目，不拉整份详情 */
export function getMenteeProjectOptions(batchId: string) {
  return prisma.menteeProject.findMany({
    where: { batchId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true },
  });
}

/** 名单里在带的那些，供记录表单勾选 */
export function getActiveMentees(batchId: string) {
  return prisma.mentee.findMany({
    where: { batchId, active: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * 建批次时顺手补齐的指导记录类型。**不在页面加载时补**——GET 不该写库；
 * 也不做成迁移里的 INSERT——字典可删，删了不该在下次迁移时复活。
 *
 * 只给这四个：资助、评优、处分这类**不建**，那是学校平台的词汇表，
 * 建了就是在做影子系统（同班主任模块的那条注释）。
 */
export const DEFAULT_MENTEE_RECORD_TYPE_NAMES = [
  "见面",
  "学业指导",
  "毕设指导",
  "生涯规划",
] as const;

/**
 * 删一名导师学生，**连同只提到他一人的指导记录**。
 *
 * 放在这里而不是 Server Action 里，是因为这段语义必须能在真库上验
 * （`scripts/verify-mentor-module.ts`）——而 Action 一被脚本 import 就会把
 * Next 的客户端运行时一起拉进来。鉴权留在 Action，数据语义只此一份。
 *
 * **为什么非删不可**：`MenteeRecord` 没有指向 `Mentee` 的外键，级联的只有成员
 * 连接表 `MenteeRecordMember`。光删学生的话，那些记录会剩下 0 个成员，
 * 而 0 成员在名单页和导出 xlsx 里**都渲染成「全批」**——一次一对一谈话
 * 悄悄变成全批集体活动，而学期末那张导师工作记录表正是从这里导出去交的。
 * 不报错、事后也查不出来，是最难发现的那种错。
 *
 * 和别人一起的记录留着，只是不再记着他：那条记录本来就不只是他的事。
 *
 * @returns 跟着删掉的记录数
 */
export async function deleteMenteeWithSoloRecords(menteeId: string): Promise<number> {
  // 一个事务：两步之间不留「记录已经 0 成员、学生还在」的中间态
  return prisma.$transaction(async (tx) => {
    const solo = await tx.menteeRecord.findMany({
      where: {
        members: { some: { menteeId } },
        // 成员里没有「别人」＝ 只提到他一人
        NOT: { members: { some: { menteeId: { not: menteeId } } } },
      },
      select: { id: true },
    });
    if (solo.length > 0) {
      await tx.menteeRecord.deleteMany({
        where: { id: { in: solo.map((record) => record.id) } },
      });
    }
    await tx.mentee.delete({ where: { id: menteeId } });
    return solo.length;
  });
}

// ─── M2：学生项目 ────────────────────────────────────────────────────

export function getMenteeProjectKinds() {
  return prisma.menteeProjectKind.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      _count: { select: { projects: true } },
    },
  });
}

/**
 * 项目列表。**有节点的按最近的那个节点排在前面**——选题季和答辩季
 * 要看的就是"接下来谁有事"。没有节点的按建的时间排在后面。
 *
 * 排序在内存里做：一个批次的项目撑死几十条，为它写一句
 * 带子查询的 orderBy 不值得，而且那句 SQL 下次改需求时没人敢动。
 */
export async function getMenteeProjects(batchId: string) {
  const projects = await prisma.menteeProject.findMany({
    where: { batchId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      schoolYear: true,
      outcomeText: true,
      achievementId: true,
      kind: { select: { id: true, name: true } },
      members: {
        orderBy: { orderIndex: "asc" },
        select: { mentee: { select: { id: true, name: true } } },
      },
      milestones: {
        orderBy: [{ date: { sort: "asc", nulls: "last" } }],
        select: { id: true, label: true, date: true },
      },
      _count: { select: { attachments: true, records: true } },
    },
  });
  return projects;
}

export function getMenteeProjectDetail(id: string) {
  return prisma.menteeProject.findUnique({
    where: { id },
    select: {
      id: true,
      batchId: true,
      batch: { select: { id: true, name: true } },
      title: true,
      schoolYear: true,
      outcomeText: true,
      note: true,
      achievementId: true,
      achievement: { select: { id: true, title: true } },
      updatedAt: true,
      kind: { select: { id: true, name: true } },
      members: {
        orderBy: { orderIndex: "asc" },
        select: { menteeId: true, mentee: { select: { id: true, name: true } } },
      },
      milestones: {
        // 有日期的按日期排；没日期的（「五月底答辩」那种）排最后
        orderBy: [{ date: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
        select: { id: true, label: true, date: true, note: true },
      },
      records: {
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          date: true,
          content: true,
          type: { select: { name: true } },
          members: { select: { mentee: { select: { id: true, name: true } } } },
        },
      },
      attachments: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true,
          filename: true,
          size: true,
          mimeType: true,
          kind: true,
          code: true,
          note: true,
          uploadedAt: true,
        },
      },
    },
  });
}

/**
 * 月历与首页倒计时用的节点。**只取填了精确日期的**——
 * 「五月底答辩」那种留空的进不来（第 8 条铁律）。
 *
 * 按模块开关过滤由调用方负责（同参赛的先例）。
 */
export function getMenteeMilestonesBetween(from: Date, to: Date) {
  return prisma.menteeProjectMilestone.findMany({
    where: { date: { gte: from, lte: to } },
    orderBy: { date: "asc" },
    select: {
      id: true,
      label: true,
      date: true,
      project: {
        select: {
          id: true,
          title: true,
          members: {
            orderBy: { orderIndex: "asc" },
            take: 1,
            select: { mentee: { select: { name: true } } },
          },
        },
      },
    },
  });
}

/**
 * 建第一个项目时补种的类型字典。理由同 DEFAULT_MENTEE_RECORD_TYPE_NAMES：
 * **不在页面加载时补**（GET 不该写库），也不做成迁移里的 INSERT（删了不该复活）。
 */
export const DEFAULT_MENTEE_PROJECT_KIND_NAMES = [
  "毕业设计",
  "大创项目",
  "课程作品",
  "实习项目",
] as const;

// ─── M3：引用为成果 + 案例索引 ──────────────────────────────────────

export type AdoptMenteeProjectResult =
  | { status: "adopted"; achievementId: string }
  | { status: "already-adopted"; achievementId: string }
  | { status: "no-outcome" }
  | { status: "not-found" };

/** 并发的第二次引用撞上已回填的指针时抛它，好让整个事务回滚 */
class AlreadyAdoptedError extends Error {}

/**
 * 把学生项目引用为一条成果。**这是学生项目进台账的唯一路径**，
 * 系统永远不会自己走这一步（第 1 条铁律、参赛与教案回流两个先例）。
 *
 * 放在这里而不是 Server Action 里，理由同 `deleteMenteeWithSoloRecords`：
 * 这段事务必须能在真库上验，而 Action 一被脚本 import 就会把 Next 的客户端
 * 运行时拉进来。鉴权、审计、revalidate 留在 Action。
 *
 * 一个事务里三件事：
 *
 * 1. 建 `Achievement`——`STUDENT_ACHIEVEMENT`、`isVerified: false` 落进「待核实」。
 *    **级别、年度、绩效小类、职称指标一概不填**：项目上没有这些事实，
 *    「校级优秀毕业设计」里的「校级」是原文不是枚举，替人解析就是在猜；
 *    而绩效「毕业设计（论文）优秀评选」只有校级和学院级有分值，
 *    按级别推分会直接推出错的（规格 §7.1，第 11 条铁律）
 * 2. 证书类材料改挂到成果上。**两个字段同一条 UPDATE**：分两步的中间态
 *    归属数是 0 或 2，会被 `Attachment_single_owner` 当场拒绝整个事务
 * 3. 回填 `achievementId`。用 `updateMany` 带 `achievementId: null` 条件——
 *    双击或两个标签页同时点时，后到的那个在这里匹配 0 行，整个事务回滚，
 *    台账里不会多出一条孤儿成果
 */
export async function adoptMenteeProjectAsAchievement(
  projectId: string,
): Promise<AdoptMenteeProjectResult> {
  const project = await prisma.menteeProject.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      title: true,
      outcomeText: true,
      achievementId: true,
      kind: { select: { name: true } },
    },
  });
  if (!project) return { status: "not-found" };
  if (project.achievementId) {
    return { status: "already-adopted", achievementId: project.achievementId };
  }
  const outcomeText = project.outcomeText?.trim();
  if (!outcomeText) return { status: "no-outcome" };

  try {
    const achievementId = await prisma.$transaction(async (tx) => {
      const achievement = await tx.achievement.create({
        data: {
          type: "STUDENT_ACHIEVEMENT",
          title: menteeAchievementTitle({
            title: project.title,
            kindName: project.kind.name,
            outcomeText,
          }),
          status: "PUBLISHED",
          declareNature: "RESULT",
          // 模块只装自己名下的学生（规格 §3），这一条是事实不是推断
          ownerRole: "指导教师",
          isVerified: false,
        },
        select: { id: true },
      });

      await tx.attachment.updateMany({
        where: {
          menteeProjectId: project.id,
          kind: { in: [...MENTEE_ADOPT_ATTACHMENT_KINDS] },
        },
        data: { menteeProjectId: null, achievementId: achievement.id },
      });

      const claimed = await tx.menteeProject.updateMany({
        where: { id: project.id, achievementId: null },
        data: { achievementId: achievement.id },
      });
      if (claimed.count === 0) throw new AlreadyAdoptedError();

      return achievement.id;
    });
    return { status: "adopted", achievementId };
  } catch (error) {
    if (!(error instanceof AlreadyAdoptedError)) throw error;
    const current = await prisma.menteeProject.findUnique({
      where: { id: projectId },
      select: { achievementId: true },
    });
    return current?.achievementId
      ? { status: "already-adopted", achievementId: current.achievementId }
      : { status: "not-found" };
  }
}

/** 全部批次的项目数。案例索引按钮看它——当前这一批是空的，别的批次可能有 */
export function countAllMenteeProjects() {
  return prisma.menteeProject.count();
}

/**
 * 案例索引的原料：**全部批次**，含已归档的。
 * 评优、职称翻的是这几年带过的所有作品，按当前批次筛就只剩今年这一届
 */
export function getMenteeCaseIndexSources(): Promise<CaseIndexSource[]> {
  return prisma.menteeProject.findMany({
    select: {
      title: true,
      schoolYear: true,
      outcomeText: true,
      createdAt: true,
      kind: { select: { name: true, sortOrder: true } },
      batch: { select: { year: true } },
      members: {
        orderBy: { orderIndex: "asc" },
        select: { mentee: { select: { name: true } } },
      },
      attachments: { select: { kind: true } },
      achievement: {
        select: { usableFor: true, attachments: { select: { kind: true } } },
      },
    },
  });
}
