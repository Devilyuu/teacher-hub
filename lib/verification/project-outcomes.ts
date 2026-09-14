import type { DeclarationSourceKind } from "@/lib/export/declaration";

type FixtureIds = {
  project: string;
  event: string;
  achievement: string;
};

type FixtureSource = {
  sourceKind: DeclarationSourceKind;
  sourceId: string;
  schoolRewarded: boolean;
  year: number | null;
  isVerified: boolean;
  declaredScore: number | null;
  perfCategory: {
    majorCategory: string;
    minorCategory: string;
  } | null;
};

function identity(source: FixtureSource): string {
  return `${source.sourceKind}:${source.sourceId}`;
}

export function assertExactFixtureSources(
  sources: readonly FixtureSource[],
  ids: FixtureIds,
): void {
  const expected = [
    `PROJECT:${ids.project}`,
    `PROJECT_EVENT:${ids.event}`,
    `ACHIEVEMENT:${ids.achievement}`,
  ].sort();
  const actual = sources.map(identity).sort();

  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    throw new Error(
      `统一导出 fixture 必须恰好各出现一次 ${expected.join("、")}；实际 ${actual.join("、") || "无"}`,
    );
  }

  if (sources.some((source) => !source.schoolRewarded)) {
    throw new Error("学校奖励事实没有精确适配到课题、课题绩效事项和成果");
  }

  const event = sources.find(
    (source) =>
      source.sourceKind === "PROJECT_EVENT" && source.sourceId === ids.event,
  );
  if (
    !event ||
    event.year !== 2026 ||
    !event.isVerified ||
    event.declaredScore !== 2 ||
    event.perfCategory == null
  ) {
    throw new Error("课题绩效事项来源丢失了奖励、年度、核实、分值或绩效分类事实");
  }
}
