import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/lib/generated/prisma/client";
import { declarationExportInputFingerprint, type DeclarationExportInputItem } from "./fingerprint";

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

import { POST } from "@/app/api/export/declaration/route";

const profile = { name: "张三", unit: "设计学院" };
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
): Request {
  const form = new FormData();
  form.set("kind", kind);
  form.set("year", "2026");
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
    });
    routeMocks.buildWorkbook.mockResolvedValue(Buffer.from("workbook"));
    routeMocks.rootCreateExportRun.mockResolvedValue({ id: "root-run" });
    routeMocks.txCreateExportRun.mockResolvedValue({ id: "tx-run" });
  });

  it.each([
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
      currentProfile: { name: "李四", unit: "艺术学院" },
    },
    {
      label: "学校奖励审定",
      input: { ...baselineInput, schoolRewarded: true },
      currentProfile: profile,
    },
  ])("$label 漂移时拒绝旧指纹且不产生文件或导出记录", async ({ input, currentProfile }) => {
    const expectedFingerprint = declarationExportInputFingerprint(
      [baselineInput],
      2026,
      "promotion",
      profile,
    );
    routeMocks.loadSources.mockResolvedValue({
      items: [input],
      profile: currentProfile,
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
    routeMocks.loadSources.mockResolvedValue({ items: [rewarded], profile });
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
