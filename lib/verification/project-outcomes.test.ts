import { describe, expect, it } from "vitest";
import { assertExactFixtureSources } from "./project-outcomes";

const ids = {
  project: "project-1",
  achievement: "achievement-1",
  event: "event-1",
};

const sources = [
  {
    sourceKind: "PROJECT" as const,
    sourceId: ids.project,
    schoolRewarded: true,
    year: 2026,
    isVerified: true,
    declaredScore: null,
    perfCategory: null,
  },
  {
    sourceKind: "PROJECT_EVENT" as const,
    sourceId: ids.event,
    schoolRewarded: true,
    year: 2026,
    isVerified: true,
    declaredScore: 2,
    perfCategory: {
      majorCategory: "科研与社会服务工作",
      minorCategory: "纵向课题",
    },
  },
  {
    sourceKind: "ACHIEVEMENT" as const,
    sourceId: ids.achievement,
    schoolRewarded: true,
    year: 2026,
    isVerified: true,
    declaredScore: 3,
    perfCategory: {
      majorCategory: "科研与社会服务工作",
      minorCategory: "研究报告",
    },
  },
];

describe("assertExactFixtureSources", () => {
  it("accepts exactly one project, event, and achievement with the rewarded event facts", () => {
    expect(() => assertExactFixtureSources(sources, ids)).not.toThrow();
  });

  it("rejects a fixture set whose project event is missing", () => {
    expect(() =>
      assertExactFixtureSources(
        sources.filter((source) => source.sourceKind !== "PROJECT_EVENT"),
        ids,
      ),
    ).toThrow(/PROJECT_EVENT:event-1/);
  });

  it("rejects a duplicate fixture identity", () => {
    expect(() =>
      assertExactFixtureSources([...sources, sources[1]], ids),
    ).toThrow(/恰好各出现一次/);
  });

  it("rejects an event that is not marked as rewarded", () => {
    expect(() =>
      assertExactFixtureSources(
        sources.map((source) =>
          source.sourceKind === "PROJECT_EVENT"
            ? { ...source, schoolRewarded: false }
            : source,
        ),
        ids,
      ),
    ).toThrow(/奖励事实/);
  });

  it.each([
    ["score", { declaredScore: null }],
    ["category", { perfCategory: null }],
  ])("rejects an event that lost its %s fact", (_, patch) => {
    expect(() =>
      assertExactFixtureSources(
        sources.map((source) =>
          source.sourceKind === "PROJECT_EVENT"
            ? { ...source, ...patch }
            : source,
        ),
        ids,
      ),
    ).toThrow(/课题绩效事项/);
  });
});
