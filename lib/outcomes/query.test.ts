import { describe, expect, it } from "vitest";
import {
  outcomeHrefWith,
  parseOutcomeQuery,
  shouldRenderMissingYearFacet,
} from "@/lib/outcomes/query";

const context = { currentYear: 2026 };

describe("parseOutcomeQuery", () => {
  it("drops unknown, empty, and array-valued parameters into canonical defaults", () => {
    const state = parseOutcomeQuery(
      {
        unknown: "keep-me-out",
        scope: ["all"],
        year: ["2026"],
        pmajor: "  ",
        major: ["科研"],
        usage: ["PERFORMANCE"],
        needslink: ["1"],
      },
      context,
    );

    expect(state.filters).toEqual({
      scope: "promotion",
      type: null,
      year: null,
      promotionMajor: null,
      promotionMinor: null,
      major: null,
      minor: null,
      usage: null,
      needsLinkOnly: false,
      unverifiedOnly: false,
    });
    expect(state.declareYear).toBe(2027);
    expect(state.anyFilter).toBe(false);
    expect(state.canonicalPath).toBe("/achievements");
    expect([...state.canonicalParams]).toEqual([]);
  });

  it.each([undefined, "", "PROMOTION", " performance ", "invalid"])(
    "normalizes invalid or missing scope %s to the omitted promotion default",
    (scope) => {
      const state = parseOutcomeQuery({ scope }, context);

      expect(state.filters.scope).toBe("promotion");
      expect(state.anyFilter).toBe(false);
      expect(state.canonicalPath).toBe("/achievements");
    },
  );

  it.each(["abc", "1e3", "0x7e8", " 2026 ", "2026.5", "0180", "1800", "2200"])(
    "rejects non-canonical or unreasonable year %s",
    (year) => {
      const state = parseOutcomeQuery({ year }, context);

      expect(state.filters.year).toBeNull();
      expect(state.yearParam).toBeNull();
      expect(state.anyFilter).toBe(false);
      expect(state.canonicalPath).toBe("/achievements");
    },
  );

  it("accepts a strict decimal year and the explicit missing-year coordinate", () => {
    const year = parseOutcomeQuery({ year: "2026" }, context);
    const missing = parseOutcomeQuery({ year: "none" }, context);

    expect(year.filters.year).toBe(2026);
    expect(year.yearParam).toBe("2026");
    expect(year.canonicalPath).toBe("/achievements?year=2026");
    expect(missing.filters.year).toBe("none");
    expect(missing.yearParam).toBe("none");
    expect(missing.anyFilter).toBe(true);
    expect(missing.canonicalPath).toBe("/achievements?year=none");
  });

  it.each(["performance", "promotion", "project_closing", "unknown", ""])(
    "rejects invalid usage %s without a type assertion",
    (usage) => {
      const state = parseOutcomeQuery({ usage }, context);

      expect(state.filters.usage).toBeNull();
      expect(state.anyFilter).toBe(false);
      expect(state.canonicalPath).toBe("/achievements");
    },
  );

  it("accepts generated AchievementUsage values and exact boolean flags", () => {
    const state = parseOutcomeQuery(
      {
        usage: "PROJECT_CLOSING",
        needslink: "1",
        unverified: "true",
      },
      context,
    );

    expect(state.filters.usage).toBe("PROJECT_CLOSING");
    expect(state.filters.needsLinkOnly).toBe(true);
    expect(state.filters.unverifiedOnly).toBe(false);
    expect(state.anyFilter).toBe(true);
    expect(state.canonicalPath).toBe(
      "/achievements?usage=PROJECT_CLOSING&needslink=1",
    );
  });

  it("normalizes dyear to next year and retains only valid non-default choices", () => {
    const missing = parseOutcomeQuery({}, context);
    const invalid = parseOutcomeQuery({ dyear: "1e3" }, context);
    const explicitDefault = parseOutcomeQuery({ dyear: "2027" }, context);
    const nonDefault = parseOutcomeQuery({ dyear: "2028" }, context);

    expect(missing.declareYear).toBe(2027);
    expect(invalid.declareYear).toBe(2027);
    expect(explicitDefault.declareYear).toBe(2027);
    expect(invalid.canonicalPath).toBe("/achievements");
    expect(explicitDefault.canonicalPath).toBe("/achievements");
    expect(nonDefault.declareYear).toBe(2028);
    expect(nonDefault.canonicalPath).toBe("/achievements?dyear=2028");
  });

  it("keeps only visible performance coordinates in all scope", () => {
    const state = parseOutcomeQuery(
      {
        scope: "all",
        pmajor: " 科研成果及业绩 ",
        pminor: " 5.2 ",
        major: " 科研与社会服务工作 ",
        minor: " 纵向课题 ",
        unverified: "1",
        unknown: "drop",
      },
      context,
    );

    expect(state.filters).toMatchObject({
      scope: "all",
      promotionMajor: null,
      promotionMinor: null,
      major: "科研与社会服务工作",
      minor: "纵向课题",
      unverifiedOnly: true,
    });
    expect(state.canonicalPath).toBe(
      "/achievements?scope=all&major=%E7%A7%91%E7%A0%94%E4%B8%8E%E7%A4%BE%E4%BC%9A%E6%9C%8D%E5%8A%A1%E5%B7%A5%E4%BD%9C&minor=%E7%BA%B5%E5%90%91%E8%AF%BE%E9%A2%98&unverified=1",
    );
  });

  it("drops performance coordinates from the promotion scope", () => {
    const state = parseOutcomeQuery(
      {
        scope: "promotion",
        major: "隐藏绩效大类",
        minor: "隐藏绩效小类",
      },
      context,
    );

    expect(state.filters).toMatchObject({
      scope: "promotion",
      promotionMajor: null,
      promotionMinor: null,
      major: null,
      minor: null,
    });
    expect(state.anyFilter).toBe(false);
    expect(state.canonicalPath).toBe("/achievements");
  });

  it("drops promotion coordinates from performance scope and never revives them on patch", () => {
    const state = parseOutcomeQuery(
      {
        scope: "performance",
        pmajor: "隐藏职称一级",
        pminor: "5.2",
      },
      context,
    );

    expect(state.filters.promotionMajor).toBeNull();
    expect(state.filters.promotionMinor).toBeNull();
    expect(state.anyFilter).toBe(false);
    expect(state.canonicalPath).toBe("/achievements?scope=performance");
    expect(outcomeHrefWith(state, { year: "2026" })).toBe(
      "/achievements?scope=performance&year=2026",
    );
  });

  it("drops orphan minor coordinates and keeps them when their visible parent exists", () => {
    const orphanPromotion = parseOutcomeQuery(
      { pminor: "5.2" },
      context,
    );
    const promotionPair = parseOutcomeQuery(
      { pmajor: "科研成果及业绩", pminor: "5.2" },
      context,
    );
    const orphanPerformance = parseOutcomeQuery(
      { scope: "performance", minor: "纵向课题" },
      context,
    );
    const performancePair = parseOutcomeQuery(
      {
        scope: "all",
        major: "科研与社会服务工作",
        minor: "纵向课题",
      },
      context,
    );

    expect(orphanPromotion.filters.promotionMinor).toBeNull();
    expect(orphanPromotion.canonicalPath).toBe("/achievements");
    expect(promotionPair.filters.promotionMinor).toBe("5.2");
    expect(promotionPair.canonicalPath).toContain("pminor=5.2");
    expect(orphanPerformance.filters.minor).toBeNull();
    expect(orphanPerformance.canonicalPath).toBe(
      "/achievements?scope=performance",
    );
    expect(performancePair.filters.minor).toBe("纵向课题");
    expect(performancePair.canonicalPath).toContain(
      "minor=%E7%BA%B5%E5%90%91%E8%AF%BE%E9%A2%98",
    );
  });

  it.each(["PAPER", "PATENT", "PROJECT"])(
    "keeps the known type %s in the canonical query",
    (type) => {
      const state = parseOutcomeQuery({ type }, context);

      expect(state.filters.type).toBe(type);
      expect(state.anyFilter).toBe(true);
      expect(state.canonicalPath).toBe(`/achievements?type=${type}`);
    },
  );

  it.each(["paper", " PAPER ", "ACHIEVEMENT", "", "OTHERS"])(
    "drops the unknown type %s",
    (type) => {
      const state = parseOutcomeQuery({ type }, context);

      expect(state.filters.type).toBeNull();
      expect(state.anyFilter).toBe(false);
      expect(state.canonicalPath).toBe("/achievements");
    },
  );

  it("keeps the type when the scope changes — the two dimensions are orthogonal", () => {
    const state = parseOutcomeQuery({ type: "PAPER", scope: "all" }, context);

    expect(outcomeHrefWith(state, { scope: null })).toBe("/achievements?type=PAPER");
  });
});

describe("outcomeHrefWith", () => {
  it("patches canonical state and clears cross-scope coordinates", () => {
    const state = parseOutcomeQuery(
      {
        scope: "all",
        year: "2026",
        pmajor: "职称一级",
        pminor: "5.2",
        major: "绩效大类",
        minor: "绩效小类",
        unknown: "drop",
      },
      context,
    );

    expect(
      outcomeHrefWith(state, {
        scope: "performance",
        year: null,
        pmajor: null,
        pminor: null,
        major: null,
        minor: null,
      }),
    ).toBe("/achievements?scope=performance");
  });

  it("normalizes invalid patch values instead of leaking them into hrefs", () => {
    const state = parseOutcomeQuery(
      { scope: "performance", usage: "PERFORMANCE" },
      context,
    );

    expect(
      outcomeHrefWith(state, {
        year: "1e3",
        usage: "invalid",
        needslink: "true",
      }),
    ).toBe("/achievements?scope=performance");
  });

  it("patches only the parsed canonical state and cannot revive discarded coordinates", () => {
    const promotion = parseOutcomeQuery(
      { major: "隐藏绩效", minor: "隐藏小类" },
      context,
    );
    const all = parseOutcomeQuery(
      {
        scope: "all",
        pmajor: "隐藏职称",
        pminor: "5.2",
        minor: "孤立绩效小类",
      },
      context,
    );

    expect(outcomeHrefWith(promotion, { year: "2026" })).toBe(
      "/achievements?year=2026",
    );
    expect(outcomeHrefWith(all, { unverified: "1" })).toBe(
      "/achievements?scope=all&unverified=1",
    );
  });
});

describe("shouldRenderMissingYearFacet", () => {
  it("keeps an explicitly selected missing-year chip visible at zero", () => {
    const selected = parseOutcomeQuery({ year: "none" }, context);
    const defaultState = parseOutcomeQuery({}, context);

    expect(shouldRenderMissingYearFacet(selected, 0)).toBe(true);
    expect(shouldRenderMissingYearFacet(defaultState, 0)).toBe(false);
    expect(shouldRenderMissingYearFacet(defaultState, 2)).toBe(true);
  });
});
