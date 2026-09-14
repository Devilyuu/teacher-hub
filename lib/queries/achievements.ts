import { prisma } from "@/lib/db";

/** 成果库列表用的视图，附带挂接情况 */
export async function getAchievementList() {
  const achievements = await prisma.achievement.findMany({
    where: { archivedAt: null },
    // 年度降序在前：年底填报时先看当年。
    // **必须显式写 nulls: "last"**——Postgres 的 DESC 默认 NULLS FIRST，
    // 不写的话 16 条没填年度的老存量会霸占列表顶部
    orderBy: [{ year: { sort: "desc", nulls: "last" } }, { updatedAt: "desc" }],
    include: {
      perfCategory: { select: { majorCategory: true, minorCategory: true } },
      promotionCategory: { select: { code: true, majorIndicator: true, minorIndicator: true } },
      _count: { select: { attachments: true } },
      links: {
        select: {
          isQualified: true,
          requirement: {
            select: { project: { select: { id: true, title: true, shortTitle: true } } },
          },
        },
      },
    },
  });

  return achievements.map((achievement) => {
    const projects = new Map<string, string>();
    for (const link of achievement.links) {
      const project = link.requirement.project;
      projects.set(project.id, project.shortTitle ?? project.title);
    }

    return {
      ...achievement,
      // Prisma 的 Decimal 过不了 Server Component 边界，这里就转掉。
      // declaredScore 是绩效口径，promotionScore 是职称口径，两套分不要互相赋值
      declaredScore: achievement.declaredScore == null ? null : Number(achievement.declaredScore),
      promotionScore:
        achievement.promotionScore == null ? null : Number(achievement.promotionScore),
      /** 挂到了哪些课题上 */
      linkedProjects: [...projects.entries()].map(([id, name]) => ({ id, name })),
      /** 一次都没挂接过。**这本身不是缺陷**，别拿它当提醒，见下面的 needsLink */
      isUnlinked: achievement.links.length === 0,
      /**
       * 说了能用于结题、却没挂到任何要求上。**只有这个才该在列表里提醒。**
       *
       * 「未挂接」曾经被做成醒目徽章，结果 73 条成果里 69 条都挂着它——
       * 因为台账里绝大多数成果（学生获奖、师德、教师发展）本来就不属于任何课题
       * （CLAUDE.md 第 4 条）。94% 的行都在报警，等于没有报警。
       *
       * 正确的口径是「标记为结题用途的成果是否挂接」：用户自己勾了
       * `PROJECT_CLOSING`，说明他认为这条能拿去结题——那它没挂上就是真的漏了。
       */
      needsLink:
        achievement.usableFor.includes("PROJECT_CLOSING") && achievement.links.length === 0,
      /**
       * 挂不上人事处任何一个二级指标 == 这条评职称用不上。
       * **这是客观事实，不是 usableFor 那种意图标记**，职称口径按它过滤
       */
      countsForPromotion: achievement.promotionCategoryId != null,
      /** 有几份支撑材料。绩效申报时"缺材料"是最要紧的信号 */
      attachmentCount: achievement._count.attachments,
      qualifiedCount: achievement.links.filter((l) => l.isQualified).length,
    };
  });
}

export async function getAchievementDetail(id: string) {
  const active = await prisma.achievement.findUnique({
    where: { id, archivedAt: null },
    include: {
      // 材料编号在前：从绩效库导入的那批按 1-1、1-2 编号，
      // 按编号排比按上传时间排更贴近纸质材料袋的顺序
      attachments: { orderBy: [{ code: "asc" }, { uploadedAt: "desc" }] },
      perfCategory: true,
      promotionCategory: true,
      schoolRewards: {
        orderBy: [
          { approvedAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
      },
      links: {
        include: {
          requirement: {
            select: {
              id: true,
              rawText: true,
              project: { select: { id: true, title: true, shortTitle: true } },
            },
          },
        },
      },
      // 「引用为成果」的来源。两类走同一个模式（外部/过程记录留在自己表里，
      // 人工引用才建成果），所以一起取、一起渲染——见 lib/outcomes/achievement-source.ts
      competitionEntries: {
        select: {
          id: true,
          year: true,
          track: true,
          level: true,
          competition: { select: { name: true } },
        },
      },
      teachingImports: {
        select: { id: true, title: true, courseName: true, term: true },
      },
    },
  });
  if (active) {
    return {
      ...active,
      archivedAt: null as null,
      legacyProjectPerformance: null,
    };
  }

  // 归档成果不再是可展示详情。这里只读最小身份，用于把历史 URL
  // 永久重定向到唯一的 Project；没有迁移事件的归档行由页面按不存在处理。
  const archived = await prisma.achievement.findUnique({
    where: { id },
    select: {
      id: true,
      archivedAt: true,
      legacyProjectPerformance: { select: { projectId: true } },
    },
  });
  if (!archived?.archivedAt) return null;
  return { ...archived, archivedAt: archived.archivedAt };
}

/**
 * 挂接候选。一次取全库，由调用方按要求项各自排除已挂的——
 * 成果总量是几十条量级，为每条要求项各查一次数据库不划算。
 */
export async function getAllLinkCandidates() {
  return prisma.achievement.findMany({
    where: { archivedAt: null },
    orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, type: true },
  });
}
