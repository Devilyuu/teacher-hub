import { describe, expect, it } from "vitest";
import {
  PROJECT_PERFORMANCE_EVENT_LABELS,
  defaultEventYear,
  projectPerformanceDraft,
  ruleColumnsForEvent,
  suggestProjectPerformanceEvent,
  toWan,
  type ProjectPerformanceSource,
} from "./project-performance";

function project(
  overrides: Partial<ProjectPerformanceSource> = {},
): ProjectPerformanceSource {
  return {
    title: "生成式人工智能赋能制造业研究",
    shortTitle: "中小企业品牌传播",
    level: "MUNICIPAL",
    role: "LEAD",
    fundingType: "VERTICAL",
    status: "CLOSED",
    applyDeadline: new Date("2025-10-01T00:00:00.000Z"),
    startDate: new Date("2026-01-10T00:00:00.000Z"),
    endDate: new Date("2027-12-31T00:00:00.000Z"),
    closingDeadline: new Date("2028-01-31T00:00:00.000Z"),
    fundingReceived: "600000",
    dateText: null,
    ...overrides,
  };
}

describe("PROJECT_PERFORMANCE_EVENT_LABELS", () => {
  it("covers the five persisted event kinds", () => {
    expect(PROJECT_PERFORMANCE_EVENT_LABELS).toEqual({
      APPLY: "申报",
      APPROVED: "立项",
      FUNDING: "到账",
      CLOSEOUT: "结题",
      OTHER: "其他",
    });
  });
});

describe("defaultEventYear", () => {
  it("uses the event-specific trusted project date", () => {
    const source = project();
    expect(defaultEventYear(source, "APPLY", 2030)).toBe(2025);
    expect(defaultEventYear(source, "APPROVED", 2030)).toBe(2026);
    expect(defaultEventYear(source, "CLOSEOUT", 2030)).toBe(2027);
  });

  it("uses the fallback for event kinds without a corresponding project date", () => {
    const source = project();
    expect(defaultEventYear(source, "FUNDING", 2030)).toBe(2030);
    expect(defaultEventYear(source, "OTHER", 2030)).toBe(2030);
  });

  it("uses the fallback when the corresponding date is missing or invalid", () => {
    expect(defaultEventYear(project({ applyDeadline: null }), "APPLY", 2030)).toBe(2030);
    expect(defaultEventYear(project({ startDate: null }), "APPROVED", 2030)).toBe(2030);
    expect(defaultEventYear(project({ endDate: null }), "CLOSEOUT", 2030)).toBe(2030);
    expect(
      defaultEventYear(project({ startDate: new Date(Number.NaN) }), "APPROVED", 2030),
    ).toBe(2030);
  });
});

describe("suggestProjectPerformanceEvent", () => {
  it("keeps rejected projects as application even if funding is recorded", () => {
    expect(
      suggestProjectPerformanceEvent(
        project({ status: "REJECTED", fundingReceived: "600000" }),
      ),
    ).toBe("APPLY");
  });

  it("prioritizes funding for closed projects when money has arrived", () => {
    expect(
      suggestProjectPerformanceEvent(
        project({ status: "CLOSED", fundingReceived: "600000" }),
      ),
    ).toBe("FUNDING");
  });

  it("prioritizes funding for draft and applying projects when money has arrived", () => {
    expect(
      suggestProjectPerformanceEvent(
        project({ status: "DRAFT", fundingReceived: "600000" }),
      ),
    ).toBe("FUNDING");
    expect(
      suggestProjectPerformanceEvent(
        project({ status: "APPLYING", fundingReceived: "600000" }),
      ),
    ).toBe("FUNDING");
  });

  it("suggests application for draft and applying projects without funding", () => {
    expect(
      suggestProjectPerformanceEvent(project({ status: "DRAFT", fundingReceived: null })),
    ).toBe("APPLY");
    expect(
      suggestProjectPerformanceEvent(project({ status: "APPLYING", fundingReceived: 0 })),
    ).toBe("APPLY");
  });

  it("suggests closeout for a closed project without funding", () => {
    expect(
      suggestProjectPerformanceEvent(project({ status: "CLOSED", fundingReceived: null })),
    ).toBe("CLOSEOUT");
    expect(
      suggestProjectPerformanceEvent(project({ status: "CLOSED", fundingReceived: 0 })),
    ).toBe("CLOSEOUT");
  });

  it("suggests funding when money has arrived on an active project", () => {
    expect(
      suggestProjectPerformanceEvent(
        project({ status: "ONGOING", fundingReceived: "600000" }),
      ),
    ).toBe("FUNDING");
  });

  it("otherwise suggests approval", () => {
    expect(
      suggestProjectPerformanceEvent(project({ status: "ONGOING", fundingReceived: null })),
    ).toBe("APPROVED");
  });
});

describe("ruleColumnsForEvent", () => {
  it("shows only the base rule for application, funding, and other events", () => {
    const source = project({ level: "PROVINCIAL" });
    expect(ruleColumnsForEvent(source, "APPLY")).toEqual(["base"]);
    expect(ruleColumnsForEvent(source, "FUNDING")).toEqual(["base"]);
    expect(ruleColumnsForEvent(source, "OTHER")).toEqual(["base"]);
  });

  it("shows both base and level rules for approval and closeout", () => {
    const source = project({ level: "PROVINCIAL" });
    expect(ruleColumnsForEvent(source, "APPROVED")).toEqual(["base", "provincial"]);
    expect(ruleColumnsForEvent(source, "CLOSEOUT")).toEqual(["base", "provincial"]);
  });

  it("falls back to the base rule when a level has no rule column", () => {
    expect(ruleColumnsForEvent(project({ level: "UNRATED" }), "APPROVED")).toEqual([
      "base",
    ]);
  });
});

describe("projectPerformanceDraft", () => {
  it("returns only child-event fields, never an Achievement-shaped draft", () => {
    const draft = projectPerformanceDraft(project(), {
      kind: "APPROVED",
      year: 2026,
      perfCategoryId: "perf-1",
      declaredScore: 18,
    });

    expect(draft).toEqual({
      kind: "APPROVED",
      year: 2026,
      perfCategoryId: "perf-1",
      declaredScore: 18,
      isVerified: false,
      note: "课题绩效事项：立项",
    });
    expect(Object.keys(draft).sort()).toEqual(
      [
        "declaredScore",
        "isVerified",
        "kind",
        "note",
        "perfCategoryId",
        "year",
      ].sort(),
    );
    expect(draft).not.toHaveProperty("title");
    expect(draft).not.toHaveProperty("type");
  });

  it.each(["APPLY", "APPROVED", "FUNDING", "CLOSEOUT", "OTHER"] as const)(
    "keeps the selected %s kind",
    (kind) => {
      expect(
        projectPerformanceDraft(project(), {
          kind,
          year: 2030,
          perfCategoryId: "perf-1",
          declaredScore: null,
        }),
      ).toMatchObject({
        kind,
        declaredScore: null,
        isVerified: false,
        note: `课题绩效事项：${PROJECT_PERFORMANCE_EVENT_LABELS[kind]}`,
      });
    },
  );
});

describe("toWan", () => {
  it("converts yuan to ten-thousands and treats invalid values as zero", () => {
    expect(toWan("600000")).toBe(60);
    expect(toWan(12000)).toBe(1.2);
    expect(toWan(null)).toBe(0);
    expect(toWan("说不清")).toBe(0);
  });
});
