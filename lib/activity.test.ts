import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  defaultCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    activityLog: { create: mocks.defaultCreate },
  },
}));

import { logActivity } from "./activity";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.defaultCreate.mockResolvedValue({ id: "activity-1" });
});

describe("logActivity", () => {
  it("uses the default Prisma client for existing callers", async () => {
    await logActivity("Project", "project-1", "修改课题信息", { title: "课题" });

    expect(mocks.defaultCreate).toHaveBeenCalledWith({
      data: {
        entityType: "Project",
        entityId: "project-1",
        action: "修改课题信息",
        detail: { title: "课题" },
      },
    });
  });

  it("uses a supplied transaction client instead of the default client", async () => {
    const transactionCreate = vi.fn().mockResolvedValue({ id: "activity-2" });
    const transactionClient = {
      activityLog: { create: transactionCreate },
    };

    await logActivity(
      "ProjectPerformanceEvent",
      "event-1",
      "新增课题绩效事项",
      { projectId: "project-1" },
      transactionClient,
    );

    expect(transactionCreate).toHaveBeenCalledOnce();
    expect(mocks.defaultCreate).not.toHaveBeenCalled();
  });

  it("接受明确的个人常用文档实体类型", async () => {
    await logActivity("PersonalDocument", "attachment-1", "上传个人常用文档", {
      filename: "课程标准.pdf",
      categoryId: "category-1",
    });

    expect(mocks.defaultCreate).toHaveBeenCalledWith({
      data: {
        entityType: "PersonalDocument",
        entityId: "attachment-1",
        action: "上传个人常用文档",
        detail: { filename: "课程标准.pdf", categoryId: "category-1" },
      },
    });
  });
});
