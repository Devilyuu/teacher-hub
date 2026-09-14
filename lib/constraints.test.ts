import { describe, expect, it } from "vitest";
import { checkConstraints, type ConstraintCheckInput } from "./constraints";
import { parseConstraints } from "./schemas/requirement";

function input(overrides: {
  allowedTypes?: ConstraintCheckInput["requirement"]["allowedTypes"];
  constraints?: unknown;
  achievement?: Partial<ConstraintCheckInput["achievement"]>;
  latestCheck?: ConstraintCheckInput["latestCheck"];
}): ConstraintCheckInput {
  return {
    requirement: {
      allowedTypes: overrides.allowedTypes ?? [],
      constraints: overrides.constraints ?? {},
    },
    achievement: { type: "PAPER", ...overrides.achievement },
    latestCheck: overrides.latestCheck,
  };
}

const messages = (i: ConstraintCheckInput) => checkConstraints(i).warnings.map((w) => w.message);

describe("parseConstraints · 宽松解析", () => {
  it("认识的 key 留下", () => {
    expect(parseConstraints({ minWords: 10000, indexedBy: "CNKI" })).toEqual({
      minWords: 10000,
      indexedBy: "CNKI",
    });
  });

  it("类型不对的 key 丢掉，不抛错", () => {
    expect(parseConstraints({ minWords: "一万字", authorPosition: 1 })).toEqual({
      authorPosition: 1,
    });
  });

  it("不认识的 key 丢掉", () => {
    expect(parseConstraints({ 随手写的: "内容", maxDupRate: 20 })).toEqual({ maxDupRate: 20 });
  });

  it("null、数组、字符串一律当空约束", () => {
    expect(parseConstraints(null)).toEqual({});
    expect(parseConstraints(undefined)).toEqual({});
    expect(parseConstraints([1, 2, 3])).toEqual({});
    expect(parseConstraints("随便写的")).toEqual({});
  });
});

describe("类型不符", () => {
  it("allowedTypes 为空数组时不提示（不限类型）", () => {
    expect(messages(input({ allowedTypes: [], achievement: { type: "AWARD" } }))).toEqual([]);
  });

  it("类型对得上不提示", () => {
    expect(messages(input({ allowedTypes: ["PAPER"], achievement: { type: "PAPER" } }))).toEqual([]);
  });

  it("类型对不上时给出中文提示", () => {
    expect(messages(input({ allowedTypes: ["PAPER"], achievement: { type: "REPORT" } }))).toEqual([
      "要求类型为论文，该成果类型为研究报告",
    ]);
  });

  it("任选型要求列出全部可选类型", () => {
    expect(
      messages(input({ allowedTypes: ["PAPER", "TEXTBOOK"], achievement: { type: "PATENT" } })),
    ).toEqual(["要求类型为论文或教材，该成果类型为专利"]);
  });

  it("任选型要求命中其一就不提示", () => {
    expect(
      messages(input({ allowedTypes: ["PAPER", "TEXTBOOK"], achievement: { type: "TEXTBOOK" } })),
    ).toEqual([]);
  });
});

describe("作者位次", () => {
  it("满足要求不提示", () => {
    expect(
      messages(input({ constraints: { authorPosition: 1 }, achievement: { authorPosition: 1 } })),
    ).toEqual([]);
  });

  it("位次靠后时提示", () => {
    expect(
      messages(input({ constraints: { authorPosition: 1 }, achievement: { authorPosition: 2 } })),
    ).toEqual(["要求第一作者，该成果作者位次为 2"]);
  });

  it("未填位次时提示信息缺失", () => {
    expect(
      messages(input({ constraints: { authorPosition: 1 }, achievement: { authorPosition: null } })),
    ).toEqual(["要求第一作者，该成果未填作者位次"]);
  });

  it("要求前两位时位次 2 算满足", () => {
    expect(
      messages(input({ constraints: { authorPosition: 2 }, achievement: { authorPosition: 2 } })),
    ).toEqual([]);
    expect(
      messages(input({ constraints: { authorPosition: 2 }, achievement: { authorPosition: 3 } })),
    ).toEqual(["要求第 2 作者及以前，该成果作者位次为 3"]);
  });
});

describe("字数", () => {
  it("字数不足时提示", () => {
    expect(
      messages(input({ constraints: { minWords: 10000 }, achievement: { wordCount: 9400 } })),
    ).toEqual(["要求 ≥10000 字，当前 9400 字"]);
  });

  it("字数达标不提示", () => {
    expect(
      messages(input({ constraints: { minWords: 10000 }, achievement: { wordCount: 10000 } })),
    ).toEqual([]);
  });

  it("超出上限时提示", () => {
    expect(
      messages(input({ constraints: { maxWords: 15000 }, achievement: { wordCount: 16000 } })),
    ).toEqual(["要求 ≤15000 字，当前 16000 字"]);
  });

  it("同时有上下限时，未填字数只提示一条", () => {
    expect(
      messages(
        input({
          constraints: { minWords: 10000, maxWords: 15000 },
          achievement: { wordCount: null },
        }),
      ),
    ).toEqual(["要求10000–15000 字，该成果未填字数"]);
  });

  it("没有字数约束时不提示未填", () => {
    expect(messages(input({ achievement: { wordCount: null } }))).toEqual([]);
  });
});

describe("收录情况", () => {
  it("包含即视为满足", () => {
    expect(
      messages(input({ constraints: { indexedBy: "CNKI" }, achievement: { indexedBy: "CNKI、EI" } })),
    ).toEqual([]);
  });

  it("大小写不敏感", () => {
    expect(
      messages(input({ constraints: { indexedBy: "CNKI" }, achievement: { indexedBy: "cnki" } })),
    ).toEqual([]);
  });

  it("不满足时提示", () => {
    expect(
      messages(input({ constraints: { indexedBy: "CNKI" }, achievement: { indexedBy: "无" } })),
    ).toEqual(["要求 CNKI 收录，该成果收录情况为 无"]);
  });

  it("未填时提示信息缺失", () => {
    expect(
      messages(input({ constraints: { indexedBy: "CNKI" }, achievement: { indexedBy: "  " } })),
    ).toEqual(["要求 CNKI 收录，该成果未填收录情况"]);
  });
});

describe("期刊级别", () => {
  it("级别一致不提示", () => {
    expect(
      messages(
        input({ constraints: { journalLevel: "省级" }, achievement: { journalLevel: "PROVINCIAL" } }),
      ),
    ).toEqual([]);
  });

  it("级别不一致时提示，不做高低排序", () => {
    // 国家级 > 省级，但各单位口径不一，这里照直说事实，不替用户判断"更高所以满足"
    expect(
      messages(
        input({ constraints: { journalLevel: "省级" }, achievement: { journalLevel: "NATIONAL" } }),
      ),
    ).toEqual(["要求省级期刊，该成果期刊级别为国家级"]);
  });

  it("未填时提示信息缺失", () => {
    expect(
      messages(input({ constraints: { journalLevel: "省级" }, achievement: { journalLevel: null } })),
    ).toEqual(["要求省级期刊，该成果未填期刊级别"]);
  });
});

describe("查重与 AIGC", () => {
  it("超标时提示", () => {
    expect(
      messages(input({ constraints: { maxDupRate: 20 }, latestCheck: { duplicationRate: 22.2 } })),
    ).toEqual(["要求查重率 ≤20%，最近一次为 22.2%"]);
  });

  it("达标不提示，等于上限也算达标", () => {
    expect(
      messages(input({ constraints: { maxDupRate: 20 }, latestCheck: { duplicationRate: 20 } })),
    ).toEqual([]);
  });

  it("还没送检不提示——没测过不是问题", () => {
    expect(messages(input({ constraints: { maxDupRate: 20 } }))).toEqual([]);
    expect(
      messages(input({ constraints: { maxDupRate: 20 }, latestCheck: { duplicationRate: null } })),
    ).toEqual([]);
  });

  it("AIGC 超标时提示", () => {
    expect(
      messages(input({ constraints: { maxAigcRate: 20 }, latestCheck: { aigcRate: 30 } })),
    ).toEqual(["要求AIGC 率 ≤20%，最近一次为 30%"]);
  });
});

describe("无法机器校验的部分", () => {
  it("checkPlatform 进人工核对清单而不是警示", () => {
    const result = checkConstraints(
      input({ constraints: { checkPlatform: "维普论文检测系统（研究生版）" } }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.manualChecks).toEqual(["须以「维普论文检测系统（研究生版）」的检测结果为准"]);
  });

  it("extra 原样进人工核对清单", () => {
    const result = checkConstraints(
      input({ constraints: { extra: ["调研案例与实证分析占比不低于50%", "须含1000字摘要"] } }),
    );

    expect(result.manualChecks).toEqual([
      "调研案例与实证分析占比不低于50%",
      "须含1000字摘要",
    ]);
  });
});

describe("综合场景", () => {
  it("多条约束同时不满足时逐条列出", () => {
    const result = checkConstraints(
      input({
        allowedTypes: ["PAPER"],
        constraints: {
          authorPosition: 1,
          minWords: 10000,
          indexedBy: "CNKI",
          checkPlatform: "维普论文检测系统（研究生版）",
          extra: ["严禁使用AI代写"],
        },
        achievement: {
          type: "REPORT",
          authorPosition: 2,
          wordCount: 9400,
          indexedBy: "无",
        },
      }),
    );

    expect(result.warnings.map((w) => w.message)).toEqual([
      "要求类型为论文，该成果类型为研究报告",
      "要求第一作者，该成果作者位次为 2",
      "要求 ≥10000 字，当前 9400 字",
      "要求 CNKI 收录，该成果收录情况为 无",
    ]);
    expect(result.manualChecks).toEqual([
      "须以「维普论文检测系统（研究生版）」的检测结果为准",
      "严禁使用AI代写",
    ]);
  });

  it("全部满足时两个清单都是空的", () => {
    const result = checkConstraints(
      input({
        allowedTypes: ["PAPER"],
        constraints: { authorPosition: 1, minWords: 8000, indexedBy: "CNKI" },
        achievement: {
          type: "PAPER",
          authorPosition: 1,
          wordCount: 9400,
          indexedBy: "CNKI",
        },
      }),
    );

    expect(result.warnings).toEqual([]);
    expect(result.manualChecks).toEqual([]);
  });
});
