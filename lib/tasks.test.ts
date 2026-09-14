import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  dueHint,
  todayQueueTasks,
  isDone,
  isDueToday,
  isOverdue,
  parseTags,
  sortTasks,
  type TaskLike,
} from "./tasks";

/** 固定"今天"＝2026-07-28，免得测试跟着真实日期漂 */
const NOW = new Date(2026, 6, 28, 10, 30);

function task(over: Partial<TaskLike> = {}): TaskLike {
  return { status: "TODO", dueDate: null, priority: "NORMAL", ...over };
}

describe("isOverdue", () => {
  it("截止日早于今天且没做完", () => {
    expect(isOverdue(task({ dueDate: dateOnly(2026, 7, 27) }), NOW)).toBe(true);
  });

  it("今天到期不算逾期", () => {
    expect(isOverdue(task({ dueDate: dateOnly(2026, 7, 28) }), NOW)).toBe(false);
  });

  it("做完了就不算逾期，哪怕当初拖了", () => {
    expect(
      isOverdue(task({ dueDate: dateOnly(2026, 7, 1), status: "DONE" }), NOW),
    ).toBe(false);
  });

  it("没填截止日的永远不逾期", () => {
    expect(isOverdue(task({ dueDate: null }), NOW)).toBe(false);
  });
});

describe("isDueToday", () => {
  it("只认今天这一天", () => {
    expect(isDueToday(task({ dueDate: dateOnly(2026, 7, 28) }), NOW)).toBe(true);
    expect(isDueToday(task({ dueDate: dateOnly(2026, 7, 29) }), NOW)).toBe(false);
    expect(isDueToday(task({ dueDate: dateOnly(2026, 7, 27) }), NOW)).toBe(false);
  });
});

describe("sortTasks", () => {
  it("截止日升序，没填的排最后", () => {
    const rows = [
      task({ dueDate: null }),
      task({ dueDate: dateOnly(2026, 8, 1) }),
      task({ dueDate: dateOnly(2026, 7, 20) }),
    ];
    expect(sortTasks(rows).map((t) => t.dueDate)).toEqual([
      dateOnly(2026, 7, 20),
      dateOnly(2026, 8, 1),
      null,
    ]);
  });

  it("同一天按优先级：高在前", () => {
    const day = dateOnly(2026, 7, 30);
    const rows = [
      task({ dueDate: day, priority: "LOW" }),
      task({ dueDate: day, priority: "HIGH" }),
      task({ dueDate: day, priority: "NORMAL" }),
    ];
    expect(sortTasks(rows).map((t) => t.priority)).toEqual(["HIGH", "NORMAL", "LOW"]);
  });

  it("不改原数组", () => {
    const rows = [task({ dueDate: dateOnly(2026, 8, 1) }), task({ dueDate: dateOnly(2026, 7, 1) })];
    const copy = [...rows];
    sortTasks(rows);
    expect(rows).toEqual(copy);
  });
});

/** 这一栏存在的意义就是省掉「今天几号了，那还剩几天」这次心算 */
describe("dueHint", () => {
  it("逾期说天数，不说日期", () => {
    expect(dueHint(task({ dueDate: dateOnly(2026, 7, 25) }), NOW)).toEqual({
      text: "已逾期 3 天",
      tone: "overdue",
    });
  });

  it("今天 / 明天单独说", () => {
    expect(dueHint(task({ dueDate: dateOnly(2026, 7, 28) }), NOW)?.text).toBe("今天截止");
    expect(dueHint(task({ dueDate: dateOnly(2026, 7, 29) }), NOW)?.text).toBe("明天截止");
  });

  it("更远的给日期加剩余天数", () => {
    expect(dueHint(task({ dueDate: dateOnly(2026, 8, 4) }), NOW)?.text).toBe(
      "2026-08-04（7 天后）",
    );
  });

  it("做完的只显示日期，不再喊逾期", () => {
    expect(dueHint(task({ dueDate: dateOnly(2026, 7, 1), status: "DONE" }), NOW)).toEqual({
      text: "2026-07-01",
      tone: "normal",
    });
  });

  it("没填截止日时没有提示", () => {
    expect(dueHint(task(), NOW)).toBeNull();
  });
});

describe("parseTags", () => {
  it("逗号、顿号、空格混用都能拆", () => {
    expect(parseTags("双高, 期末、迎评 教学")).toEqual(["双高", "期末", "迎评", "教学"]);
  });

  it("去重", () => {
    expect(parseTags("双高 双高，双高")).toEqual(["双高"]);
  });

  it("空串是空数组", () => {
    expect(parseTags("   ")).toEqual([]);
  });

  it("最多 8 个——再多就不是标签是正文了", () => {
    expect(parseTags("a b c d e f g h i j")).toHaveLength(8);
  });
});

/**
 * 首页收件箱**只放能被处理掉的事**（PRD 第 2 节）。
 * 放全量就和「日常」模块重复了，两者的边界必须守住。
 */
describe("todayQueueTasks", () => {
  it("逾期、今天到期、高优先级三类进收件箱", () => {
    const overdue = task({ dueDate: dateOnly(2026, 7, 20) });
    const today = task({ dueDate: dateOnly(2026, 7, 28) });
    const high = task({ priority: "HIGH", dueDate: null });
    const later = task({ dueDate: dateOnly(2026, 12, 1) });
    const noDue = task({ dueDate: null });

    const inbox = todayQueueTasks([overdue, today, high, later, noDue], NOW);
    expect(inbox).toHaveLength(3);
    expect(inbox).not.toContain(later);
    expect(inbox).not.toContain(noDue);
  });

  it("做完的一律不进——收件箱里的每条都应该是能被处理掉的", () => {
    const done = task({ status: "DONE", dueDate: dateOnly(2026, 7, 1), priority: "HIGH" });
    expect(todayQueueTasks([done], NOW)).toHaveLength(0);
  });

  it("按截止日排好序", () => {
    const a = task({ dueDate: dateOnly(2026, 7, 26) });
    const b = task({ dueDate: dateOnly(2026, 7, 20) });
    expect(todayQueueTasks([a, b], NOW)[0]).toBe(b);
  });
});

describe("isDone", () => {
  it("只有 DONE 算完成", () => {
    expect(isDone({ status: "DONE" })).toBe(true);
    expect(isDone({ status: "DOING" })).toBe(false);
    expect(isDone({ status: "TODO" })).toBe(false);
  });
});
