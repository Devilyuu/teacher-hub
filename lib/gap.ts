/**
 * 缺口计算 —— 全站唯一的复杂逻辑，规则见 PRD 第 3 节。
 *
 * 这里是唯一实现处，前端只消费结果，禁止在组件里重算（CLAUDE.md 第 6 条）。
 * 入参用结构化类型而不是 Prisma 模型，这样单测不需要数据库。
 *
 * 系统只计算，不判定：`isQualified` 一律来自人工勾选，本文件永远不会
 * 根据成果状态、约束是否满足去推断达标与否（CLAUDE.md 第 1 条）。
 */
import { diffInDays, todayAsDateOnly } from "@/lib/date";
import type { ProjectStatus } from "@/lib/generated/prisma/enums";

// ─── 入参 ────────────────────────────────────────────────────────────

export type GapLinkInput = {
  achievementId: string;
  isQualified: boolean;
};

export type GapMaterialInput = {
  attachmentId: string;
  isQualified: boolean;
};

export type GapRequirementInput = {
  id: string;
  requiredCount: number;
  links: GapLinkInput[];
  materials: GapMaterialInput[];
};

export type GapProjectInput = {
  status: ProjectStatus;
  archivedAt?: Date | null;
  /** DRAFT / APPLYING 期的倒计时基准 */
  applyDeadline?: Date | null;
  /** 结题材料提交截止日。看板倒计时用它，不是 endDate */
  closingDeadline?: Date | null;
  requirements: GapRequirementInput[];
};

// ─── 出参 ────────────────────────────────────────────────────────────

export type RequirementGap = {
  requirementId: string;
  requiredCount: number;
  /** 已人工确认达标的成果与课题材料数（分别按 id 去重） */
  qualifiedCount: number;
  /** 已挂接但尚未确认达标的成果与课题材料数 */
  inProgressCount: number;
  /** max(0, requiredCount - qualifiedCount) */
  gap: number;
};

/**
 * 看板配色。PRD 第 3 节定义了前六种，`UNSET` 是本实现补的第七种，
 * 用于 ONGOING/CLOSING 但一条结题要求都没录的课题——此时缺口恒为 0，
 * 按原规则会判成 GREEN（已齐备），而系统其实什么都不知道，
 * 显示"已齐备"就是在替用户下判断。刚立项、评审书还没到手的课题正是这种情况。
 */
export type ProjectHealth = "GREY" | "BLUE" | "GREEN" | "YELLOW" | "ORANGE" | "RED" | "UNSET";

export type ProjectGap = {
  requirements: RequirementGap[];
  /** Σ requiredCount */
  totalRequired: number;
  /** 按 achievementId 全课题去重后的达标数，详见 countDistinctQualified */
  totalQualified: number;
  /** Σ 各要求项的 gap */
  totalGap: number;
  /** totalRequired 为 0、或课题处于申报期时返回 null，界面渲染"—"而不是 0% */
  completionRate: number | null;
  /** 距结题材料截止日的天数，可为负（已逾期）；无截止日时为 null */
  daysLeft: number | null;
  /** 距申报截止日的天数，口径同上 */
  applyDaysLeft: number | null;
  /**
   * 界面该显示哪个倒计时：申报期看 applyDeadline，其余看 closingDeadline。
   * 放在这里算，省得每个组件自己判断状态再挑字段。
   */
  displayDaysLeft: number | null;
  health: ProjectHealth;
  /** 在本课题内被两条以上要求项同时算作达标的成果，界面据此提示重复使用 */
  reusedAchievementIds: string[];
};

// ─── 单个要求项 ──────────────────────────────────────────────────────

function resourceIds(requirement: GapRequirementInput, isQualified: boolean): string[] {
  return [
    ...requirement.links
      .filter((link) => link.isQualified === isQualified)
      .map((link) => `achievement:${link.achievementId}`),
    ...requirement.materials
      .filter((material) => material.isQualified === isQualified)
      .map((material) => `attachment:${material.attachmentId}`),
  ];
}

export function calcRequirementGap(requirement: GapRequirementInput): RequirementGap {
  const requiredCount = Math.max(0, requirement.requiredCount);

  // 两张连接表各有唯一约束，这里仍按「资源类型:id」去重：
  // 一是防历史脏数据，二是避免 Achievement 与 Attachment 恰好同 id 时互相吞掉。
  const qualified = new Set(resourceIds(requirement, true));
  const inProgress = new Set(resourceIds(requirement, false));

  const qualifiedCount = qualified.size;
  return {
    requirementId: requirement.id,
    requiredCount,
    qualifiedCount,
    inProgressCount: inProgress.size,
    gap: Math.max(0, requiredCount - qualifiedCount),
  };
}

// ─── 课题级去重 ──────────────────────────────────────────────────────

/**
 * PRD 第 3 节的两条硬规则在这里交汇：
 *   totalQualified = Σ min(qualifiedCount, requiredCount)
 *   且必须按 achievementId 去重
 *
 * 一篇论文既算"论文 2 篇"又算"标志性成果 1 项"时只能计一次，否则完成度虚高。
 *
 * 直接按要求项顺序贪心分配会得出与顺序有关的结果：
 *   要求甲(需1) 挂 {A}，要求乙(需1) 挂 {A, B}
 *   先甲后乙 → 甲取 A、乙取 B，得 2；先乙后甲 → 乙取 A、甲无可取，得 1。
 * 同一批数据因为排序不同算出两个完成度，工具就没法信了。
 *
 * 所以这里求二分图最大匹配（Kuhn 增广路）：每个成果最多占一个名额，
 * 每条要求项有 requiredCount 个名额，取全局能填满的最大数量。
 * 结果与顺序无关，且不会低估。数据规模是个位数到几十，性能不是问题。
 */
function countDistinctQualified(requirements: GapRequirementInput[]): number {
  // 名额：要求项 i 的第 j 个坑，编号 `${i}:${j}`。
  // 一条要求项实际能被填的坑不会超过它自己的达标挂接数，据此收窄，
  // 避免 requiredCount 被误录成很大的数时凭空造出海量节点。
  const slotsOfResource = new Map<string, string[]>();

  requirements.forEach((requirement, requirementIndex) => {
    const qualifiedIds = [...new Set(resourceIds(requirement, true))];
    const slotCount = Math.min(Math.max(0, requirement.requiredCount), qualifiedIds.length);
    if (slotCount === 0) return;

    const slots = Array.from({ length: slotCount }, (_, j) => `${requirementIndex}:${j}`);
    for (const resourceId of qualifiedIds) {
      const existing = slotsOfResource.get(resourceId);
      if (existing) {
        existing.push(...slots);
      } else {
        slotsOfResource.set(resourceId, [...slots]);
      }
    }
  });

  /** 名额 → 占用它的成果或课题材料 */
  const occupiedBy = new Map<string, string>();

  function tryOccupy(resourceId: string, visited: Set<string>): boolean {
    for (const slot of slotsOfResource.get(resourceId) ?? []) {
      if (visited.has(slot)) continue;
      visited.add(slot);

      const incumbent = occupiedBy.get(slot);
      // 空位直接占；有人占着就让对方去找别的位置（增广）
      if (incumbent === undefined || tryOccupy(incumbent, visited)) {
        occupiedBy.set(slot, resourceId);
        return true;
      }
    }
    return false;
  }

  for (const resourceId of slotsOfResource.keys()) {
    tryOccupy(resourceId, new Set());
  }

  return occupiedBy.size;
}

/** 在本课题内被两条以上要求项同时算作达标的成果 */
function findReusedAchievements(requirements: GapRequirementInput[]): string[] {
  const seenIn = new Map<string, number>();
  for (const requirement of requirements) {
    const qualifiedIds = new Set(
      requirement.links.filter((l) => l.isQualified).map((l) => l.achievementId),
    );
    for (const id of qualifiedIds) {
      seenIn.set(id, (seenIn.get(id) ?? 0) + 1);
    }
  }
  return [...seenIn.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort();
}

// ─── 健康度 ──────────────────────────────────────────────────────────

// 未获立项的也算「已结束」：它不会再产生成果，缺口和倒计时对它都没有意义
const FINISHED_STATUSES: ProjectStatus[] = ["CLOSED", "TERMINATED", "REJECTED"];
const APPLY_STAGE_STATUSES: ProjectStatus[] = ["DRAFT", "APPLYING"];

function calcHealth(
  project: GapProjectInput,
  totalRequired: number,
  totalGap: number,
  daysLeft: number | null,
  applyDaysLeft: number | null,
): ProjectHealth {
  // 顺序不能调：已结束最先判定，否则会被后面的缺口规则染成红色
  if (project.archivedAt != null || FINISHED_STATUSES.includes(project.status)) {
    return "GREY";
  }

  if (APPLY_STAGE_STATUSES.includes(project.status)) {
    if (applyDaysLeft == null) return "BLUE";
    if (applyDaysLeft <= 7) return "RED";
    if (applyDaysLeft <= 30) return "ORANGE";
    return "BLUE";
  }

  // 在研却一条要求都没录：缺口恒为 0，但不能因此说"已齐备"
  if (totalRequired === 0) return "UNSET";

  if (totalGap === 0) return "GREEN";
  if (daysLeft == null || daysLeft > 90) return "YELLOW";
  if (daysLeft > 30) return "ORANGE";
  return "RED";
}

// ─── 课题 ────────────────────────────────────────────────────────────

/**
 * @param today 注入当前日期，便于测试；生产调用不传即可。
 */
export function calcProjectGap(project: GapProjectInput, today: Date = new Date()): ProjectGap {
  const requirements = project.requirements.map(calcRequirementGap);

  const totalRequired = requirements.reduce((sum, r) => sum + r.requiredCount, 0);
  const totalGap = requirements.reduce((sum, r) => sum + r.gap, 0);
  const totalQualified = countDistinctQualified(project.requirements);

  // 截止日是纯日期（@db.Date），必须按 UTC 口径比较，详见 lib/date.ts
  const todayDate = todayAsDateOnly(today);
  const daysLeft =
    project.closingDeadline == null ? null : diffInDays(project.closingDeadline, todayDate);
  const applyDaysLeft =
    project.applyDeadline == null ? null : diffInDays(project.applyDeadline, todayDate);
  const isApplyStage = APPLY_STAGE_STATUSES.includes(project.status);

  // 两处返回 null 的理由不同，但界面表现一致（显示"—"）：
  // 1. totalRequired == 0 —— PRD 第 3 节硬规则，除零不能返回 0
  // 2. 申报期课题 —— 结题清单尚未存在，谈完成度没有意义
  const completionRate =
    totalRequired === 0 || isApplyStage ? null : totalQualified / totalRequired;

  return {
    requirements,
    totalRequired,
    totalQualified,
    totalGap,
    completionRate,
    daysLeft,
    applyDaysLeft,
    displayDaysLeft: isApplyStage ? applyDaysLeft : daysLeft,
    health: calcHealth(project, totalRequired, totalGap, daysLeft, applyDaysLeft),
    reusedAchievementIds: findReusedAchievements(project.requirements),
  };
}
