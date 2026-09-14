import { describe, expect, it } from "vitest";
import { auditPayload, teachingImportPayloadSchema } from "./teaching-import";

const valid = {
  externalSystem: "teaching-design-system",
  externalId: "lesson-42",
  title: "《数字媒体技术》第三章教案",
};

function parse(input: Record<string, unknown>) {
  return teachingImportPayloadSchema.safeParse({ ...valid, ...input });
}

describe("回流载荷", () => {
  it("最小载荷通过", () => {
    const result = teachingImportPayloadSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it("缺必填被拒", () => {
    expect(parse({ externalId: "" }).success).toBe(false);
    expect(parse({ title: "" }).success).toBe(false);
    expect(parse({ externalSystem: undefined }).success).toBe(false);
  });

  it("来源系统标识限制字符集", () => {
    // 它会进日志和路径判断，别让对方送 ../ 这类东西进来
    expect(parse({ externalSystem: "../etc" }).success).toBe(false);
    expect(parse({ externalSystem: "teaching/system" }).success).toBe(false);
    expect(parse({ externalSystem: "teaching_design-system.v2" }).success).toBe(true);
  });

  it("超长字段被拒", () => {
    expect(parse({ title: "长".repeat(201) }).success).toBe(false);
    expect(parse({ externalId: "x".repeat(129) }).success).toBe(false);
    expect(parse({ courseName: "长".repeat(101) }).success).toBe(false);
    expect(parse({ term: "长".repeat(51) }).success).toBe(false);
  });
});

describe("学期", () => {
  it("原样收下，不校验格式", () => {
    // 规范化是来源系统的事（备课系统的 normalize_term），而来源未必只有它一个。
    // 这里只保证有长度上限、空串归 undefined
    const result = parse({ term: "2025-2026 第二学期" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.term).toBe("2025-2026 第二学期");
  });

  it("不填也行，空白归 undefined", () => {
    expect(parse({ term: undefined }).success).toBe(true);
    const blank = parse({ term: "  " });
    expect(blank.success).toBe(true);
    if (blank.success) expect(blank.data.term).toBeUndefined();
  });
});

describe("完成日期", () => {
  it("只认 YYYY-MM-DD", () => {
    expect(parse({ finishedAt: "2026/08/05" }).success).toBe(false);
    expect(parse({ finishedAt: "2026-8-5" }).success).toBe(false);
    expect(parse({ finishedAt: "August 5, 2026" }).success).toBe(false);
  });

  it("按 UTC 纯日期解析", () => {
    // 纯日期列必须走 lib/date.ts 的 UTC 口径，否则倒计时会差一天
    const result = parse({ finishedAt: "2026-08-05" });
    expect(result.success).toBe(true);
    if (!result.success) return;
    const value = result.data.finishedAt!;
    expect(value.toISOString()).toBe("2026-08-05T00:00:00.000Z");
  });

  it("不存在的日期被拒，而不是悄悄滚到下个月", () => {
    // dateOnly 不校验月末：2026-02-31 会变成 3 月 3 日。
    // 对内部表单来说宽容是体贴，对外部接口来说是把脏数据放进库
    expect(parse({ finishedAt: "2026-02-31" }).success).toBe(false);
    expect(parse({ finishedAt: "2026-13-01" }).success).toBe(false);
  });
});

describe("审计载荷", () => {
  it("只留白名单字段", () => {
    const parsed = teachingImportPayloadSchema.parse({
      ...valid,
      courseName: "数字媒体技术",
      term: "2025-2026 第二学期",
      finishedAt: "2026-08-05",
      note: "第三章",
    });

    expect(auditPayload(parsed)).toEqual({
      externalSystem: "teaching-design-system",
      externalId: "lesson-42",
      title: "《数字媒体技术》第三章教案",
      courseName: "数字媒体技术",
      term: "2025-2026 第二学期",
      finishedAt: "2026-08-05",
      note: "第三章",
    });
  });

  it("日期存回 YYYY-MM-DD 而不是 Date", () => {
    // 存 Date 的话 JSON 里会变成带时刻的 ISO 串，看起来像精确到秒，
    // 而它本来只是一天
    const parsed = teachingImportPayloadSchema.parse({ ...valid, finishedAt: "2026-08-05" });
    expect(auditPayload(parsed).finishedAt).toBe("2026-08-05");
  });

  it("缺省字段不写进 payload", () => {
    const parsed = teachingImportPayloadSchema.parse(valid);
    const payload = auditPayload(parsed);
    expect("courseName" in payload).toBe(false);
    expect("finishedAt" in payload).toBe(false);
    expect("note" in payload).toBe(false);
  });

  it("不含任何鉴权字段", () => {
    // 这条是本文件里最重要的一条：整体转存请求会把 Authorization 一起写进库，
    // 毫无症状，直到全库备份（3.8）把令牌一起送出门
    const parsed = teachingImportPayloadSchema.parse(valid);
    const keys = Object.keys(auditPayload(parsed));
    for (const key of keys) {
      expect(/authorization|token|secret|bearer/i.test(key)).toBe(false);
    }
  });
});
