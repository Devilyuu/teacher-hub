import { describe, expect, it } from "vitest";
import { achievementSources } from "@/lib/outcomes/achievement-source";

const competition = {
  id: "entry-1",
  year: 2026,
  track: "软件测试赛项",
  level: "PROVINCIAL" as const,
  competition: { name: "职业院校技能大赛" },
};

const teaching = {
  id: "import-1",
  title: "第 8 周 · 单元测试",
  courseName: "软件测试技术",
  term: "2025-2026 第二学期",
};

describe("achievementSources", () => {
  it("直接建的成果没有来源——台账里绝大多数是这种", () => {
    expect(achievementSources({})).toEqual([]);
    expect(
      achievementSources({ competitionEntries: [], teachingImports: [] }),
    ).toEqual([]);
  });

  it("参赛来源用和参赛页一致的称呼，跳回那条记录", () => {
    expect(achievementSources({ competitionEntries: [competition] })).toEqual([
      {
        key: "competition:entry-1",
        kind: "competition",
        kindLabel: "指导参赛",
        label: "2026 职业院校技能大赛 · 软件测试赛项",
        href: "/competitions/entry-1",
        hint: null,
      },
    ]);
  });

  it("教案回流没有详情页，跳教学枢纽；课程和学期拼成补充信息", () => {
    expect(achievementSources({ teachingImports: [teaching] })).toEqual([
      {
        key: "teaching:import-1",
        kind: "teaching",
        kindLabel: "教案回流",
        label: "第 8 周 · 单元测试",
        href: "/teaching",
        hint: "软件测试技术 · 2025-2026 第二学期",
      },
    ]);
  });

  it("课程和学期都没有时 hint 是 null，不留一个空括号", () => {
    const [source] = achievementSources({
      teachingImports: [{ ...teaching, courseName: null, term: null }],
    });
    expect(source?.hint).toBeNull();
  });

  it("参赛排在教案回流前面——它带日期、队员和证书，核对时先看它", () => {
    expect(
      achievementSources({
        competitionEntries: [competition],
        teachingImports: [teaching],
      }).map((source) => source.kind),
    ).toEqual(["competition", "teaching"]);
  });

  it("同类多条全部返回，不按「最多一个」把后面的吞掉", () => {
    // 引用动作会挡住重复引用，所以实际上到不了两条。但库里这是一对多，
    // 真出现两条时界面该都画出来——静悄悄只画第一条等于替数据库
    // 做它没做的保证
    const sources = achievementSources({
      competitionEntries: [competition, { ...competition, id: "entry-2" }],
    });
    expect(sources.map((source) => source.key)).toEqual([
      "competition:entry-1",
      "competition:entry-2",
    ]);
  });
});
