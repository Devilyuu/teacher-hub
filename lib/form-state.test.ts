import { describe, expect, it } from "vitest";
import { z } from "zod";
import { toFormState } from "@/lib/form-state";

const schema = z.object({
  name: z.string().trim().min(1, "给这批学生起个名字").max(8, "名字太长了"),
  year: z.coerce.number().int("年份得是整数").min(1990, "年份看着不对"),
  note: z.string(),
});

function fail(input: unknown) {
  const parsed = schema.safeParse(input);
  if (parsed.success) throw new Error("expected failure");
  return toFormState(parsed.error);
}

describe("toFormState", () => {
  // 不少表单只渲染 state.message、不画字段级报错。原来那句「看下标红的地方」
  // 在它们那里兑现不了——2026-09-24 用户建批次时满屏找不到一处红
  it("整体提示直接说出第一条原因", () => {
    const state = fail({ name: "", year: "2025", note: "" });
    expect(state.ok).toBe(false);
    expect(state.message).toBe("给这批学生起个名字");
  });

  it("不止一处时报出第一条，并说还有几处", () => {
    const state = fail({ name: "", year: "1800", note: "" });
    expect(state.message).toBe("给这批学生起个名字（另有 1 处没填对）");
  });

  it("字段级报错照旧按字段名分组，画了红框的表单不受影响", () => {
    const state = fail({ name: "", year: "1800", note: "" });
    expect(state.fieldErrors).toEqual({
      name: ["给这批学生起个名字"],
      year: ["年份看着不对"],
    });
  });

  it("表单少交一个键（zod 自带的英文报错）照实说是系统的问题，带上字段名", () => {
    const state = fail({ name: "2025艺术设计", year: "2025" });
    expect(state.message).toContain("「note」");
    expect(state.message).toContain("不是你填错了");
    expect(state.message).not.toMatch(/expected|received/);
  });
});
