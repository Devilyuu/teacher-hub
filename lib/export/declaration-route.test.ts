import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import type { PromotionCapRule } from "@/lib/promotion";
import {
  declarationExportInputFingerprint,
  type DeclarationExportInputItem,
  type DeclarationExportProfile,
} from "./fingerprint";

/** 5.1 论文本栏上限 10 分（2026 版表） */
const capRule51: PromotionCapRule = {
  code: "5.1",
  majorIndicator: "科研能力",
  minorIndicator: "论文",
  majorCap: 50,
  cap: 10,
  capGroup: "5.1",
};

const routeMocks = vi.hoisted(() => ({
  sessionGuard: vi.fn(),
  loadSources: vi.fn(),
  transaction: vi.fn(),
  findExportRun: vi.fn(),
  rootCreateExportRun: vi.fn(),
  txCreateExportRun: vi.fn(),
  buildWorkbook: vi.fn(),
}));

vi.mock("@/lib/server-auth", () => ({
  sessionGuard: routeMocks.sessionGuard,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: routeMocks.transaction,
    exportRun: {
      findUnique: routeMocks.findExportRun,
      create: routeMocks.rootCreateExportRun,
    },
  },
}));

vi.mock("@/lib/export/sources", () => ({
  loadDeclarationExportSources: routeMocks.loadSources,
}));

vi.mock("@/lib/export/workbook", () => ({
  buildDeclarationWorkbook: routeMocks.buildWorkbook,
}));

// 支撑材料不碰真磁盘：每个文件的内容就是它的存储路径
vi.mock("@/lib/storage", () => ({
  openUploadStream: (storagePath: string) =>
    async function* () {
      yield new TextEncoder().encode(`content of ${storagePath}`);
    },
}));

import { POST } from "@/app/api/export/declaration/route";

const profile: DeclarationExportProfile = { name: "张三", unit: "设计学院", currentTitleSince: null };
const baselineInput: DeclarationExportInputItem = {
  id: "a1",
  sourceKind: "ACHIEVEMENT",
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

function exportRequest(
  expectedFingerprint: string,
  kind: "promotion" | "performance" = "promotion",
  year = 2026,
): Request {
  const form = new FormData();
  form.set("kind", kind);
  form.set("year", String(year));
  form.set("preflightFingerprint", expectedFingerprint);
  form.set("requestKey", "route-drift-request");
  return new Request("https://desk.example/api/export/declaration", {
    method: "POST",
    headers: { origin: "https://desk.example" },
    body: form,
  });
}

describe("POST /api/export/declaration · 预检后数据漂移", () => {
  const tx = {
    exportRun: {
      findUnique: routeMocks.findExportRun,
      create: routeMocks.txCreateExportRun,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.sessionGuard.mockResolvedValue(null);
    routeMocks.findExportRun.mockResolvedValue(null);
    routeMocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    routeMocks.loadSources.mockResolvedValue({
      items: [baselineInput],
      profile,
      capRules: [],
    });
    routeMocks.buildWorkbook.mockResolvedValue(Buffer.from("workbook"));
    routeMocks.rootCreateExportRun.mockResolvedValue({ id: "root-run" });
    routeMocks.txCreateExportRun.mockResolvedValue({ id: "tx-run" });
  });

  it.each<{
    label: string;
    input: DeclarationExportInputItem;
    currentProfile: DeclarationExportProfile;
    currentCapRules?: PromotionCapRule[];
  }>([
    {
      label: "级别",
      input: { ...baselineInput, level: "国家级" },
      currentProfile: profile,
    },
    {
      label: "职称分类编号与名称",
      input: {
        ...baselineInput,
        promotionCategory: {
          code: "5.2",
          majorIndicator: "科研业绩",
          minorIndicator: "高水平论文",
        },
      },
      currentProfile: profile,
    },
    {
      label: "档案姓名与单位",
      input: baselineInput,
      currentProfile: { ...profile, name: "李四", unit: "艺术学院" },
    },
    {
      label: "学校奖励审定",
      input: { ...baselineInput, schoolRewarded: true },
      currentProfile: profile,
    },
    {
      label: "档案任现职日期",
      input: baselineInput,
      currentProfile: { ...profile, currentTitleSince: new Date(Date.UTC(2021, 8, 1)) },
    },
    {
      // 预检之后重新导入了量化表：汇总表上的封顶后合计就不是页面上看到的那个数
      label: "职称量化表封顶规则",
      input: baselineInput,
      currentProfile: profile,
      currentCapRules: [capRule51],
    },
  ])("$label 漂移时拒绝旧指纹且不产生文件或导出记录", async ({
    input,
    currentProfile,
    currentCapRules,
  }) => {
    const expectedFingerprint = declarationExportInputFingerprint(
      [baselineInput],
      2026,
      "promotion",
      profile,
    );
    routeMocks.loadSources.mockResolvedValue({
      items: [input],
      profile: currentProfile,
      capRules: currentCapRules ?? [],
    });

    const response = await POST(exportRequest(expectedFingerprint));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "成果数据在预检后发生变化，请刷新导出页并重新确认",
    });
    expect(routeMocks.buildWorkbook).not.toHaveBeenCalled();
    expect(routeMocks.rootCreateExportRun).not.toHaveBeenCalled();
    expect(routeMocks.txCreateExportRun).not.toHaveBeenCalled();
  });

  it("在同一个 Serializable 事务快照中排除 2026 年学校已奖励绩效并写入空快照", async () => {
    const rewarded = { ...baselineInput, schoolRewarded: true };
    routeMocks.loadSources.mockResolvedValue({ items: [rewarded], profile, capRules: [] });
    const fingerprint = declarationExportInputFingerprint(
      [rewarded],
      2026,
      "performance",
      profile,
    );

    const response = await POST(exportRequest(fingerprint, "performance"));

    expect(response.status).toBe(200);
    expect(routeMocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: "Serializable" },
    );
    expect(routeMocks.loadSources).toHaveBeenCalledWith(tx);
    expect(routeMocks.findExportRun).toHaveBeenCalledWith({
      where: { requestKey: "route-drift-request" },
      select: { id: true },
    });
    expect(routeMocks.rootCreateExportRun).not.toHaveBeenCalled();
    expect(routeMocks.txCreateExportRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "PERF_DECLARATION",
        includedCount: 0,
        snapshot: [],
      }),
    });
    expect(routeMocks.buildWorkbook).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "performance",
        groups: [],
        total: 0,
      }),
      profile,
      undefined,
    );
  });

  /**
   * 职称表的 year 是申报年度，取「任现职以来 → 申报年度上一年 12-31」，
   * 起点读档案里的任现职日期。2026-09-25 以前这里按年度精确匹配，
   * 导出的量化表只有申报当年的几条——而那几条按规定恰好一条都不算
   */
  it("职称表按档案任现职日期取时间窗，申报当年和任现职之前的都不进表", async () => {
    const titled = { ...profile, currentTitleSince: new Date(Date.UTC(2020, 8, 1)) };
    const items = [
      { ...baselineInput, id: "before", sourceId: "before", href: "/achievements/before", year: 2019 },
      { ...baselineInput, id: "inside", sourceId: "inside", href: "/achievements/inside", year: 2023 },
      { ...baselineInput, id: "edge", sourceId: "edge", href: "/achievements/edge", year: 2026 },
      { ...baselineInput, id: "current", sourceId: "current", href: "/achievements/current", year: 2027 },
    ];
    routeMocks.loadSources.mockResolvedValue({ items, profile: titled, capRules: [] });
    const fingerprint = declarationExportInputFingerprint(items, 2027, "promotion", titled);

    const response = await POST(exportRequest(fingerprint, "promotion", 2027));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(
      encodeURIComponent("2027年申报职称量化表.xlsx"),
    );
    const [pkg, meta] = routeMocks.buildWorkbook.mock.calls[0];
    expect(
      pkg.groups.flatMap((group: { rows: { sourceId: string }[] }) =>
        group.rows.map((row) => row.sourceId),
      ),
    ).toEqual(["inside", "edge"]);
    expect(meta).toBe(titled);
    expect(routeMocks.txCreateExportRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "PROMOTION_DECLARATION",
        year: 2027,
        includedCount: 2,
      }),
    });
  });

  /** 明细逐条写原始分，汇总另写封顶后合计——人事处核的是后者，前者要和它对得上账 */
  it("职称表按量化表封顶算合计，明细照旧是原始分", async () => {
    const items = [
      { ...baselineInput, id: "p1", sourceId: "p1", href: "/achievements/p1", promotionScore: 7 },
      { ...baselineInput, id: "p2", sourceId: "p2", href: "/achievements/p2", promotionScore: 6 },
    ];
    routeMocks.loadSources.mockResolvedValue({ items, profile, capRules: [capRule51] });
    const fingerprint = declarationExportInputFingerprint(
      items,
      2027,
      "promotion",
      profile,
      [capRule51],
    );

    const response = await POST(exportRequest(fingerprint, "promotion", 2027));

    expect(response.status).toBe(200);
    const [pkg] = routeMocks.buildWorkbook.mock.calls[0];
    expect(pkg.total).toBe(13);
    expect(
      pkg.groups.flatMap((group: { rows: { score: number }[] }) => group.rows.map((row) => row.score)),
    ).toEqual([7, 6]);
    expect(pkg.caps).toMatchObject({
      rawTotal: 13,
      cappedTotal: 10,
      overCap: [{ label: "5.1", raw: 13, cap: 10 }],
    });
  });

  it("绩效表不套职称封顶", async () => {
    routeMocks.loadSources.mockResolvedValue({
      items: [baselineInput],
      profile,
      capRules: [capRule51],
    });
    const fingerprint = declarationExportInputFingerprint(
      [baselineInput],
      2026,
      "performance",
      profile,
      [capRule51],
    );

    const response = await POST(exportRequest(fingerprint, "performance"));

    expect(response.status).toBe(200);
    expect(routeMocks.buildWorkbook.mock.calls[0][0].caps).toBeUndefined();
  });

  it.each([
    ["P2002", "这次导出请求已经处理，请刷新页面后重试"],
    ["P2034", "导出期间数据发生并发变化，请刷新页面后重试"],
  ])("把 Prisma %s 并发冲突安全映射为 409", async (code, expectedMessage) => {
    const error = new Prisma.PrismaClientKnownRequestError("internal database detail", {
      code,
      clientVersion: "test",
    });
    routeMocks.rootCreateExportRun.mockRejectedValue(error);
    routeMocks.txCreateExportRun.mockRejectedValue(error);
    const fingerprint = declarationExportInputFingerprint(
      [baselineInput],
      2026,
      "promotion",
      profile,
    );

    const response = await POST(exportRequest(fingerprint));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: expectedMessage });
    expect(routeMocks.transaction).toHaveBeenCalledOnce();
    expect(routeMocks.txCreateExportRun).toHaveBeenCalledOnce();
    expect(routeMocks.rootCreateExportRun).not.toHaveBeenCalled();
  });
});

/** 从尾部读中央目录，列出条目名（同 lib/zip.test.ts：断言对着字节，不对着某个解压工具） */
function zipEntryNames(zip: Buffer): string[] {
  const eocd = zip.length - 22;
  expect(zip.readUInt32LE(eocd)).toBe(0x06054b50);
  const count = zip.readUInt16LE(eocd + 10);
  let cursor = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i++) {
    const nameLength = zip.readUInt16LE(cursor + 28);
    names.push(zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8"));
    cursor += 46 + nameLength + zip.readUInt16LE(cursor + 30) + zip.readUInt16LE(cursor + 32);
  }
  return names;
}

describe("POST /api/export/declaration · 申报包 ZIP", () => {
  const tx = {
    exportRun: {
      findUnique: routeMocks.findExportRun,
      create: routeMocks.txCreateExportRun,
    },
  };
  const certificate = {
    id: "file-1",
    kind: "AWARD_CERTIFICATE" as const,
    filename: "省一等奖证书.pdf",
    storagePath: "2026/abc",
    size: 1024,
    uploadedAt: new Date("2026-03-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    routeMocks.sessionGuard.mockResolvedValue(null);
    routeMocks.findExportRun.mockResolvedValue(null);
    routeMocks.transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );
    routeMocks.buildWorkbook.mockResolvedValue(Buffer.from("workbook"));
    routeMocks.txCreateExportRun.mockResolvedValue({ id: "tx-run" });
  });

  function zipRequest(fingerprint: string): Request {
    const form = new FormData();
    form.set("kind", "performance");
    form.set("year", "2026");
    form.set("preflightFingerprint", fingerprint);
    form.set("requestKey", "zip-request");
    form.set("format", "zip");
    return new Request("https://desk.example/api/export/declaration", {
      method: "POST",
      headers: { origin: "https://desk.example" },
      body: form,
    });
  }

  /** prd-ledger 4.2：申报表 + 支撑材料（文件按材料编号命名），编号就是明细表的序号 */
  it("根目录一张申报表，支撑材料按明细表序号命名，内容逐字节搬进包", async () => {
    routeMocks.loadSources.mockResolvedValue({
      items: [baselineInput],
      profile,
      capRules: [],
      materials: new Map([["ACHIEVEMENT:a1", [certificate]]]),
    });
    const fingerprint = declarationExportInputFingerprint([baselineInput], 2026, "performance", profile);

    const response = await POST(zipRequest(fingerprint));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain(
      encodeURIComponent("2026年度绩效申报包.zip"),
    );
    const zip = Buffer.from(await response.arrayBuffer());
    expect(zipEntryNames(zip)).toEqual([
      "2026年度绩效申报表.xlsx",
      "支撑材料/01-1_获奖证书_省一等奖证书.pdf",
    ]);
    expect(zip.includes(Buffer.from("content of 2026/abc"))).toBe(true);
    expect(zip.includes(Buffer.from("workbook"))).toBe(true);

    // 审计：格式记进 options，每行附了哪些文件记进快照
    expect(routeMocks.txCreateExportRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        kind: "PERF_DECLARATION",
        options: { includeUnverified: false, includeMissingYear: false, format: "zip" },
        snapshot: [
          expect.objectContaining({
            index: 1,
            sourceId: "a1",
            materials: [
              { attachmentId: "file-1", name: "支撑材料/01-1_获奖证书_省一等奖证书.pdf", size: 1024 },
            ],
          }),
        ],
      }),
    });
  });

  it("材料超过 500MB 就拦下来，不记导出也不出文件", async () => {
    routeMocks.loadSources.mockResolvedValue({
      items: [baselineInput],
      profile,
      capRules: [],
      materials: new Map([["ACHIEVEMENT:a1", [{ ...certificate, size: 600 * 1024 * 1024 }]]]),
    });
    const fingerprint = declarationExportInputFingerprint([baselineInput], 2026, "performance", profile);

    const response = await POST(zipRequest(fingerprint));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("600MB") });
    expect(routeMocks.txCreateExportRun).not.toHaveBeenCalled();
  });

  it("不带 format 照旧只给那张 xlsx", async () => {
    routeMocks.loadSources.mockResolvedValue({
      items: [baselineInput],
      profile,
      capRules: [],
      materials: new Map([["ACHIEVEMENT:a1", [certificate]]]),
    });
    const fingerprint = declarationExportInputFingerprint([baselineInput], 2026, "performance", profile);
    const form = await zipRequest(fingerprint).formData();
    form.delete("format");

    const response = await POST(
      new Request("https://desk.example/api/export/declaration", {
        method: "POST",
        headers: { origin: "https://desk.example" },
        body: form,
      }),
    );

    expect(response.headers.get("Content-Type")).toContain("spreadsheetml");
    expect(routeMocks.txCreateExportRun).toHaveBeenCalledWith({
      data: expect.objectContaining({
        options: { includeUnverified: false, includeMissingYear: false, format: "xlsx" },
      }),
    });
  });
});
