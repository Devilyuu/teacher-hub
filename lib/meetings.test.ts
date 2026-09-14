import { describe, expect, it } from "vitest";
import {
  parseAgenda,
  parseMeetingTime,
  parseResolutions,
  pendingResolutionCount,
  toDatetimeLocal,
} from "./meetings";

/**
 * Json 列读回来是 unknown。**脏数据一律丢掉而不是抛错**——
 * 一条格式坏了的议程不该让整个会议页打不开。
 */
describe("parseAgenda", () => {
  it("正常的字符串数组原样返回", () => {
    expect(parseAgenda(["开学工作部署", "实训室安全检查"])).toEqual([
      "开学工作部署",
      "实训室安全检查",
    ]);
  });

  it("不是数组时给空数组，不抛错", () => {
    expect(parseAgenda(null)).toEqual([]);
    expect(parseAgenda("一条议程")).toEqual([]);
    expect(parseAgenda({ a: 1 })).toEqual([]);
  });

  it("混进去的非字符串和空串都丢掉", () => {
    expect(parseAgenda(["有效", 42, null, "  ", { x: 1 }, "也有效"])).toEqual(["有效", "也有效"]);
  });
});

describe("parseResolutions", () => {
  it("补齐缺省字段", () => {
    expect(parseResolutions([{ text: "各教研室报选题" }])).toEqual([
      { text: "各教研室报选题", assignee: "我", dueDate: null, convertedTaskId: null },
    ]);
  });

  it("没有正文的丢掉——那是坏数据", () => {
    expect(parseResolutions([{ assignee: "我" }, { text: "" }, { text: "  " }])).toEqual([]);
  });

  it("非数组给空数组", () => {
    expect(parseResolutions(undefined)).toEqual([]);
  });

  it("保留已转任务的标记", () => {
    const rows = parseResolutions([
      { text: "交材料", assignee: "我", dueDate: "2026-08-01", convertedTaskId: "task_1" },
    ]);
    expect(rows[0].convertedTaskId).toBe("task_1");
    expect(rows[0].dueDate).toBe("2026-08-01");
  });

  it("保留聚合纪要的录音审计键", () => {
    const rows = parseResolutions([{
      recordingId: "recording-1",
      candidateId: "resolution-1-abc",
      text: "保留来源",
      assignee: "我",
      dueDate: null,
      convertedTaskId: null,
    }]);
    expect(rows[0]).toMatchObject({
      recordingId: "recording-1",
      candidateId: "resolution-1-abc",
    });
  });
});

/** 同一条决议不能转两次——这个计数就是界面上「还有 N 条没派下去」的来源 */
describe("pendingResolutionCount", () => {
  it("只数还没转成任务的", () => {
    expect(
      pendingResolutionCount([
        { text: "甲", convertedTaskId: "t1" },
        { text: "乙" },
        { text: "丙", convertedTaskId: null },
      ]),
    ).toBe(2);
  });

  it("空的是 0", () => {
    expect(pendingResolutionCount(null)).toBe(0);
  });
});

describe("parseMeetingTime", () => {
  it("解析 datetime-local 的值", () => {
    const parsed = parseMeetingTime("2026-07-08T14:30");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(6);
    expect(parsed?.getDate()).toBe(8);
    expect(parsed?.getHours()).toBe(14);
    expect(parsed?.getMinutes()).toBe(30);
  });

  it("格式不对给 null，不给 Invalid Date", () => {
    expect(parseMeetingTime("2026/07/08 14:30")).toBeNull();
    expect(parseMeetingTime("")).toBeNull();
    expect(parseMeetingTime("2026-07-08")).toBeNull();
  });
});

describe("toDatetimeLocal", () => {
  it("与 parseMeetingTime 互为逆运算", () => {
    const value = "2026-07-08T14:30";
    expect(toDatetimeLocal(parseMeetingTime(value)!)).toBe(value);
  });

  it("个位数月日时分补零", () => {
    expect(toDatetimeLocal(new Date(2026, 0, 5, 9, 5))).toBe("2026-01-05T09:05");
  });
});
