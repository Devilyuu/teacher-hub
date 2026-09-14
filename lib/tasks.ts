/**
 * 任务的纯逻辑（prd-routines 3）。从 dept-cockpit 的 `lib/task-helpers.ts` 迁入。
 *
 * 迁入时的三处改造：
 *
 * 1. **日期一律走 `lib/date.ts`。** 原模块自带一套 Asia/Shanghai 的 `dates.ts`，
 *    本平台已有 UTC 纯日期口径，两套并存必然有一天算差一天。
 * 2. **枚举化。** 原来是 `String + // 注释`，中文散在组件里；
 *    现在走 Prisma enum + `lib/labels.ts`。
 * 3. **配色不照搬。** 原来 `SELF` 用绿色、`SUPERIOR` 用红色——
 *    绿色在本平台有确定含义（结题要求已齐备），红色是健康度的「紧急」，
 *    拿去当来源底色，看板上一眼扫过去会分不清是"这项达标了"还是"这是自我待办"。
 *    来源改用中性描边，只有「上级布置」保留一点强调（CLAUDE.md 视觉语言）。
 *
 * 不碰数据库，单测在同名 .test.ts。
 */
import { diffInDays, formatDateOnly, todayAsDateOnly } from "@/lib/date";
import type { TaskPriority, TaskStatus } from "@/lib/generated/prisma/enums";

/** 判断用得到的最小形状。故意不依赖 Prisma 的完整类型，测试才好造数据 */
export type TaskLike = {
  status: TaskStatus;
  dueDate: Date | null;
  priority: TaskPriority;
};

export function isDone(task: Pick<TaskLike, "status">): boolean {
  return task.status === "DONE";
}

/**
 * 逾期是**算出来的，从不存库**：截止日早于今天且没做完。
 * 存一个 OVERDUE 状态的话，跨过零点就得有人去改它。
 */
export function isOverdue(task: TaskLike, now: Date = new Date()): boolean {
  if (isDone(task) || task.dueDate == null) return false;
  return diffInDays(task.dueDate, todayAsDateOnly(now)) < 0;
}

/** 今天到期（含今天）且没做完 */
export function isDueToday(task: TaskLike, now: Date = new Date()): boolean {
  if (isDone(task) || task.dueDate == null) return false;
  return diffInDays(task.dueDate, todayAsDateOnly(now)) === 0;
}

const PRIORITY_RANK: Record<TaskPriority, number> = { HIGH: 0, NORMAL: 1, LOW: 2 };

/** 截止日升序（没填的排最后），同日按优先级 */
export function sortTasks<T extends TaskLike>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const ad = a.dueDate?.getTime() ?? Infinity;
    const bd = b.dueDate?.getTime() ?? Infinity;
    if (ad !== bd) return ad - bd;
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  });
}

export type DueTone = "overdue" | "today" | "normal";

/**
 * 截止日的人话提示。**逾期说"已逾期 N 天"而不是日期**——
 * 日期要人自己去减，而这一栏存在的意义就是省掉那次心算。
 */
export function dueHint(
  task: TaskLike,
  now: Date = new Date(),
): { text: string; tone: DueTone } | null {
  if (task.dueDate == null) return null;

  const dateText = formatDateOnly(task.dueDate);
  if (isDone(task)) return { text: dateText, tone: "normal" };

  const days = diffInDays(task.dueDate, todayAsDateOnly(now));
  if (days < 0) return { text: `已逾期 ${-days} 天`, tone: "overdue" };
  if (days === 0) return { text: "今天截止", tone: "today" };
  if (days === 1) return { text: "明天截止", tone: "today" };
  return { text: `${dateText}（${days} 天后）`, tone: "normal" };
}

/**
 * 自由标签串（「双高, 期末 迎评」）拆成干净的去重列表。
 * 上限 8 个——再多就不是标签是正文了。
 */
export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/[,，、\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ].slice(0, 8);
}

/**
 * 首页「今天要处理」的任务：**只放能被处理掉的**（PRD 第 2 节）。
 *
 * 逾期的 + 今天到期的 + 高优先级未完成的。完整列表在 /tasks，
 * 首页放全量就和「日常」模块重复了——两者的边界必须守住。
 *
 * **以前叫 `inboxTasks`，二期 2.6 改名。** 「收件箱」现在专指待归类的速记
 * （`CaptureItem`），这里是任务视图，两者是首页上并列的两块。
 */
export function todayQueueTasks<T extends TaskLike>(tasks: T[], now: Date = new Date()): T[] {
  return sortTasks(
    tasks.filter(
      (task) =>
        !isDone(task) &&
        (isOverdue(task, now) || isDueToday(task, now) || task.priority === "HIGH"),
    ),
  );
}
