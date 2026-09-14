import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildCatalogPlan } from "@/lib/import/perf-rules";
import { buildPromotionPlan } from "@/lib/import/promotion-rules";

/**
 * examples/ 下的两份示例规则表是给别的学校的老师照着改的格式样板。
 * **它们必须一直导得进去**：导入器改了字段、示例没跟上，别人照抄过去第一步就报错。
 */
function example(name: string): unknown {
  return JSON.parse(readFileSync(resolve(process.cwd(), "examples", name), "utf-8"));
}

describe("examples/ 示例规则表", () => {
  it("绩效积分表示例能通过校验，没有告警", () => {
    const { drafts, warnings } = buildCatalogPlan(example("performance-rules.example.json"));
    expect(drafts).toHaveLength(6);
    expect(warnings).toEqual([]);
  });

  it("职称量化表示例能通过校验，封顶合计与系列总分对得上", () => {
    const plan = buildPromotionPlan(example("promotion-rules.example.json"));
    expect(plan.drafts).toHaveLength(5);
    expect(plan.warnings).toEqual([]);
    expect(plan.checks.every((check) => check.ok)).toBe(true);
  });
});
