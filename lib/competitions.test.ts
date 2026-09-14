import { describe, expect, it } from "vitest";
import {
  achievementTitleFor,
  entryTitle,
  groupByYear,
  summarize,
  upcomingCompetitionDeadlines,
} from "@/lib/competitions";
import { dateOnly } from "@/lib/date";
import { parseMemberList } from "@/lib/schemas/competition";

const base = {
  id: "e1",
  year: 2026,
  competitionName: "职业院校技能大赛",
  track: "软件测试赛项",
  level: "PROVINCIAL" as const,
  status: "REGISTERED",
  registerDeadline: null,
  competeAt: null,
  award: null,
};

describe("entryTitle", () => {
  it("级别不进标题——它是同一赛事各赛段的区分位，列表里另有徽章", () => {
    expect(entryTitle(base)).toBe("2026 职业院校技能大赛 · 软件测试赛项");
    expect(entryTitle({ ...base, track: null })).toBe("2026 职业院校技能大赛");
  });
});

describe("achievementTitleFor", () => {
  it("有奖状原文就用原文——评审要核对的是奖状上那行字", () => {
    expect(
      achievementTitleFor({ ...base, award: "FIRST", awardTitle: "省一等奖" }),
    ).toBe("指导学生获省一等奖");
  });

  it("没有原文才按枚举拼", () => {
    expect(achievementTitleFor({ ...base, award: "SECOND", awardTitle: null })).toBe(
      "指导学生参加2026年省级职业院校技能大赛软件测试赛项二等奖",
    );
  });

  it("未获奖不把「未获奖」拼进标题", () => {
    expect(achievementTitleFor({ ...base, award: "NONE", awardTitle: null })).toBe(
      "指导学生参加2026年省级职业院校技能大赛软件测试赛项",
    );
  });
});

describe("upcomingCompetitionDeadlines", () => {
  const now = new Date("2026-03-10T09:00:00+08:00");

  it("报名截止和比赛日期各出一条，按剩余天数排", () => {
    const items = upcomingCompetitionDeadlines(
      [
        {
          ...base,
          registerDeadline: dateOnly(2026, 3, 20),
          competeAt: dateOnly(2026, 3, 15),
        },
      ],
      now,
    );
    expect(items.map((item) => [item.kind, item.daysLeft])).toEqual([
      ["compete", 5],
      ["register", 10],
    ]);
  });

  it("逾期的报名截止不留——报名通道已经关了，留着只是每天扎一下", () => {
    expect(
      upcomingCompetitionDeadlines(
        [{ ...base, registerDeadline: dateOnly(2026, 3, 1) }],
        now,
      ),
    ).toEqual([]);
  });

  it("当天到期仍然显示（daysLeft = 0），不算逾期", () => {
    expect(
      upcomingCompetitionDeadlines(
        [{ ...base, registerDeadline: dateOnly(2026, 3, 10) }],
        now,
      ),
    ).toHaveLength(1);
  });

  it("已放弃的不提醒", () => {
    expect(
      upcomingCompetitionDeadlines(
        [
          {
            ...base,
            status: "WITHDRAWN",
            registerDeadline: dateOnly(2026, 3, 20),
            competeAt: dateOnly(2026, 3, 15),
          },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("已经出了结果就不再提醒报名截止，但比赛日期照旧（改期/补赛还看得见）", () => {
    const items = upcomingCompetitionDeadlines(
      [
        {
          ...base,
          award: "FIRST",
          registerDeadline: dateOnly(2026, 3, 20),
          competeAt: dateOnly(2026, 3, 15),
        },
      ],
      now,
    );
    expect(items.map((item) => item.kind)).toEqual(["compete"]);
  });
});

describe("groupByYear", () => {
  it("年度倒序", () => {
    expect(
      groupByYear([{ year: 2024 }, { year: 2026 }, { year: 2024 }]).map(
        (group) => [group.year, group.entries.length],
      ),
    ).toEqual([
      [2026, 1],
      [2024, 2],
    ]);
  });
});

describe("summarize", () => {
  it("未获奖（NONE）不计进获奖数，但它是事实不是空值", () => {
    const stats = summarize([
      { status: "COMPETED", award: "NONE" },
      { status: "COMPETED", award: "FIRST" },
      { status: "TRAINING", award: null },
      { status: "WITHDRAWN", award: null },
    ]);
    expect(stats).toEqual({ total: 4, ongoing: 1, awarded: 1 });
  });
});

describe("parseMemberList", () => {
  it("制表符/中英文逗号/顿号分列，第二列起当备注", () => {
    expect(parseMemberList("张三\t队长\n李四，负责答辩\n王五")).toEqual([
      { name: "张三", note: "队长" },
      { name: "李四", note: "负责答辩" },
      { name: "王五", note: null },
    ]);
  });

  it("同名跳过——整块重复粘贴是安全的", () => {
    expect(parseMemberList("张三\n张三\n")).toEqual([{ name: "张三", note: null }]);
  });

  it("空行和纯空白行忽略", () => {
    expect(parseMemberList("\n  \n张三\n")).toEqual([{ name: "张三", note: null }]);
  });
});
