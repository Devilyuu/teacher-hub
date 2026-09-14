import { describe, expect, it } from "vitest";
import { declarationExportInputFingerprint } from "./fingerprint";

const item = {
  id: "a1",
  sourceKind: "ACHIEVEMENT" as const,
  sourceId: "a1",
  href: "/achievements/a1",
  schoolRewarded: false,
  title: "某篇论文",
  year: 2026,
  isVerified: true,
  status: "PUBLISHED",
  level: "省级",
  type: "论文",
  ownerRole: "第一作者",
  authorPosition: 1,
  dateText: "2026年",
  attachmentCount: 1,
  perfCategoryId: "perf-1",
  promotionCategoryId: "promo-1",
  perfCategory: { majorCategory: "科研", minorCategory: "论文" },
  promotionCategory: {
    code: "5.1",
    majorIndicator: "科研能力",
    minorIndicator: "论文",
  },
  declaredScore: 3,
  promotionScore: 2,
};

describe("declarationExportInputFingerprint", () => {
  const profile = { name: "张三", unit: "设计学院" };

  it("同一批数据不受查询顺序影响", () => {
    const a = { ...item, sourceId: "a", href: "/achievements/a" };
    const b = { ...item, sourceId: "b", href: "/achievements/b" };
    expect(declarationExportInputFingerprint([a, b], 2026, "promotion", profile)).toBe(
      declarationExportInputFingerprint([b, a], 2026, "promotion", profile),
    );
  });

  it("任何影响预检或导出的字段变化都会改变指纹", () => {
    const original = declarationExportInputFingerprint([item], 2026, "promotion", profile);
    expect(
      declarationExportInputFingerprint(
        [{ ...item, isVerified: false }],
        2026,
        "promotion",
        profile,
      ),
    ).not.toBe(original);
    expect(
      declarationExportInputFingerprint(
        [{ ...item, attachmentCount: 2 }],
        2026,
        "promotion",
        profile,
      ),
    ).not.toBe(original);
  });

  it.each([
    ["级别", { ...item, level: "国家级" }],
    ["本人角色", { ...item, ownerRole: "通讯作者" }],
    ["作者排名", { ...item, authorPosition: 2 }],
  ])("%s 漂移会改变最终导出输入指纹", (_label, changed) => {
    expect(declarationExportInputFingerprint([changed], 2026, "promotion", profile)).not.toBe(
      declarationExportInputFingerprint([item], 2026, "promotion", profile),
    );
  });

  it("绩效分类名称漂移会改变最终导出输入指纹", () => {
    const changed = {
      ...item,
      perfCategory: { majorCategory: "科研与社会服务", minorCategory: "高水平论文" },
    };
    expect(declarationExportInputFingerprint([changed], 2026, "performance", profile)).not.toBe(
      declarationExportInputFingerprint([item], 2026, "performance", profile),
    );
  });

  it("职称分类编号或名称漂移会改变最终导出输入指纹", () => {
    const changed = {
      ...item,
      promotionCategory: {
        code: "5.2",
        majorIndicator: "科研业绩",
        minorIndicator: "高水平论文",
      },
    };
    expect(declarationExportInputFingerprint([changed], 2026, "promotion", profile)).not.toBe(
      declarationExportInputFingerprint([item], 2026, "promotion", profile),
    );
  });

  it("工作簿中的姓名或单位漂移会改变最终导出输入指纹", () => {
    const original = declarationExportInputFingerprint([item], 2026, "promotion", profile);
    expect(
      declarationExportInputFingerprint([item], 2026, "promotion", {
        ...profile,
        name: "李四",
      }),
    ).not.toBe(original);
    expect(
      declarationExportInputFingerprint([item], 2026, "promotion", {
        ...profile,
        unit: "艺术学院",
      }),
    ).not.toBe(original);
  });

  it("正式学校奖励在预检后新增会改变指纹", () => {
    const original = declarationExportInputFingerprint([item], 2026, "performance", profile);
    expect(
      declarationExportInputFingerprint(
        [{ ...item, schoolRewarded: true }],
        2026,
        "performance",
        profile,
      ),
    ).not.toBe(original);
  });

  it("同一字符串编号的不同来源不是同一行", () => {
    expect(
      declarationExportInputFingerprint(
        [{ ...item, sourceKind: "PROJECT" }],
        2026,
        "promotion",
        profile,
      ),
    ).not.toBe(
      declarationExportInputFingerprint([item], 2026, "promotion", profile),
    );
  });
});
