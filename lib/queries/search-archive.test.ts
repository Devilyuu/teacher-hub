import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  projectFindMany: vi.fn(),
  achievementFindMany: vi.fn(),
  taskFindMany: vi.fn(),
  meetingFindMany: vi.fn(),
  dutyFindMany: vi.fn(),
  attachmentFindMany: vi.fn(),
  studentFindMany: vi.fn(),
  honorFindMany: vi.fn(),
  competitionEntryFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    project: { findMany: mocks.projectFindMany },
    achievement: { findMany: mocks.achievementFindMany },
    task: { findMany: mocks.taskFindMany },
    meeting: { findMany: mocks.meetingFindMany },
    dutyRecord: { findMany: mocks.dutyFindMany },
    attachment: { findMany: mocks.attachmentFindMany },
    student: { findMany: mocks.studentFindMany },
    studentHonor: { findMany: mocks.honorFindMany },
    competitionEntry: { findMany: mocks.competitionEntryFindMany },
  },
}));

import { MODULES, type ModuleVisibility } from "@/lib/modules";
import { search, type SearchHit } from "@/lib/queries/search";

/** 全开。这些用例考察的是查询边界，不是模块开关 */
const ALL_ON = Object.fromEntries(
  MODULES.map((module) => [module.key, true]),
) as ModuleVisibility;

type AttachmentCandidate = {
  id: string;
  projectId: string | null;
  achievementId: string | null;
  docCategoryId: string | null;
  filename: string;
  note: string | null;
  uploadedAt: Date;
  docCategory: { name: string } | null;
};

const attachmentCandidates: AttachmentCandidate[] = [
  {
    id: "document-filename",
    projectId: null,
    achievementId: null,
    docCategoryId: "category-course",
    filename: "2026课程标准.pdf",
    note: null,
    uploadedAt: new Date("2026-08-06T00:00:00Z"),
    docCategory: { name: "课程标准" },
  },
  {
    id: "document-note",
    projectId: null,
    achievementId: null,
    docCategoryId: "category-reference",
    filename: "申报通知.pdf",
    note: "课程建设申报参考",
    uploadedAt: new Date("2026-08-05T00:00:00Z"),
    docCategory: { name: "申报参考" },
  },
  {
    id: "document-missing-category-relation",
    projectId: null,
    achievementId: null,
    docCategoryId: "category-missing",
    filename: "课程异常附件.pdf",
    note: null,
    uploadedAt: new Date("2026-08-04T00:00:00Z"),
    docCategory: null,
  },
  {
    id: "project-attachment",
    projectId: "project-1",
    achievementId: null,
    docCategoryId: null,
    filename: "课程课题附件.pdf",
    note: null,
    uploadedAt: new Date("2026-08-03T00:00:00Z"),
    docCategory: null,
  },
  {
    id: "achievement-attachment",
    projectId: null,
    achievementId: "achievement-1",
    docCategoryId: null,
    filename: "成果证据.pdf",
    note: "课程成果证据",
    uploadedAt: new Date("2026-08-02T00:00:00Z"),
    docCategory: null,
  },
  {
    id: "ownerless-attachment",
    projectId: null,
    achievementId: null,
    docCategoryId: null,
    filename: "课程孤儿附件.pdf",
    note: null,
    uploadedAt: new Date("2026-08-01T00:00:00Z"),
    docCategory: null,
  },
  {
    id: "category-name-only",
    projectId: null,
    achievementId: null,
    docCategoryId: "category-course",
    filename: "人才培养方案.pdf",
    note: null,
    uploadedAt: new Date("2026-07-31T00:00:00Z"),
    docCategory: { name: "课程标准" },
  },
];

function matchesNullableOwner(
  row: AttachmentCandidate,
  field: "projectId" | "achievementId" | "docCategoryId",
  condition: unknown,
) {
  if (condition === undefined) return true;
  if (condition === null) return row[field] === null;
  if (
    typeof condition === "object" &&
    condition !== null &&
    "not" in condition &&
    (condition as { not: unknown }).not === null
  ) {
    return row[field] !== null;
  }
  return false;
}

function matchesString(value: string | null, condition: unknown) {
  if (value === null || typeof condition !== "object" || condition === null) return false;
  const filter = condition as { contains?: unknown; mode?: unknown };
  if (typeof filter.contains !== "string") return false;
  return filter.mode === "insensitive"
    ? value.toLocaleLowerCase().includes(filter.contains.toLocaleLowerCase())
    : value.includes(filter.contains);
}

/**
 * 模拟 Prisma 真正执行 where/orderBy/take/select，而不是无条件返回预制结果。
 * 这样少写任一 owner 条件或误把分类名加入 OR，候选夹具就会实际泄漏到返回值里。
 */
function executeAttachmentFindMany(args: Record<string, unknown>) {
  const where = (args.where ?? {}) as Record<string, unknown>;
  const clauses = Array.isArray(where.OR) ? where.OR : [];
  const select = (args.select ?? {}) as Record<string, unknown>;

  let rows = attachmentCandidates.filter(
    (row) =>
      matchesNullableOwner(row, "projectId", where.projectId) &&
      matchesNullableOwner(row, "achievementId", where.achievementId) &&
      matchesNullableOwner(row, "docCategoryId", where.docCategoryId) &&
      (clauses.length === 0 ||
        clauses.some((clause) => {
          const filter = clause as Record<string, unknown>;
          return (
            matchesString(row.filename, filter.filename) || matchesString(row.note, filter.note)
          );
        })),
  );

  if (
    typeof args.orderBy === "object" &&
    args.orderBy !== null &&
    (args.orderBy as { uploadedAt?: unknown }).uploadedAt === "desc"
  ) {
    rows = [...rows].sort((left, right) => right.uploadedAt.getTime() - left.uploadedAt.getTime());
  }
  if (typeof args.take === "number") rows = rows.slice(0, args.take);

  return rows.map((row) => ({
    ...(select.id ? { id: row.id } : {}),
    ...(select.filename ? { filename: row.filename } : {}),
    ...(select.docCategory ? { docCategory: row.docCategory } : {}),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue([]);
});

describe("global search query boundaries", () => {
  it("returns a complete empty result without issuing any database query", async () => {
    const results = await search(" \t ", ALL_ON);

    expect(results).toEqual({
      query: "",
      hits: [],
      counts: {
        project: 0,
        achievement: 0,
        task: 0,
        meeting: 0,
        duty: 0,
        document: 0,
        student: 0,
        honor: 0,
        competition: 0,
      },
    });
    for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
  });

  it("starts the personal-document query in parallel with all five existing queries", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (const mock of Object.values(mocks)) {
      mock.mockImplementationOnce(async () => {
        await gate;
        return [];
      });
    }

    const pending = search("课", ALL_ON);

    for (const mock of Object.values(mocks)) expect(mock).toHaveBeenCalledOnce();
    release();
    await pending;
  });

  it("queries only personal attachments by filename or note with the exact minimal shape", async () => {
    mocks.attachmentFindMany.mockImplementation(executeAttachmentFindMany);

    const results = await search("课程", ALL_ON);

    expect(mocks.attachmentFindMany).toHaveBeenCalledWith({
      where: {
        projectId: null,
        achievementId: null,
        docCategoryId: { not: null },
        OR: [
          { filename: { contains: "课程", mode: "insensitive" } },
          { note: { contains: "课程", mode: "insensitive" } },
        ],
      },
      select: {
        id: true,
        filename: true,
        docCategory: { select: { name: true } },
      },
      take: 8,
      orderBy: { uploadedAt: "desc" },
    });
    expect(results.hits).toEqual([
      {
        kind: "document",
        id: "document-filename",
        title: "2026课程标准.pdf",
        meta: "课程标准",
        href: "/api/attachments/document-filename?download=1",
      },
      {
        kind: "document",
        id: "document-note",
        title: "申报通知.pdf",
        meta: "申报参考",
        href: "/api/attachments/document-note?download=1",
      },
    ]);
    expect(results.counts).toEqual({
      project: 0,
      achievement: 0,
      task: 0,
      meeting: 0,
      duty: 0,
      document: 2,
      student: 0,
      honor: 0,
      competition: 0,
    });
    expect(results.hits).not.toContainEqual(
      expect.objectContaining({ id: "document-missing-category-relation" }),
    );
    for (const hit of results.hits) {
      expect(hit.href).toBe(`/api/attachments/${hit.id}?download=1`);
      expect(hit.href).not.toContain(hit.title);
    }
  });

  it("keeps the per-kind cap on all six queries", async () => {
    await search("课", ALL_ON);

    for (const mock of Object.values(mocks)) {
      expect(mock).toHaveBeenCalledWith(expect.objectContaining({ take: 8 }));
    }
  });

  it("轮派模块关闭时不查、不返回轮派记录——导航上没有的东西搜索里也不该有", async () => {
    mocks.dutyFindMany.mockResolvedValue([
      { id: "duty-1", title: "轮派任务", date: new Date("2026-08-02Z"), dutyType: { name: "值班" } },
    ]);

    const results = await search("轮派", { ...ALL_ON, duties: false });

    expect(mocks.dutyFindMany).not.toHaveBeenCalled();
    expect(results.counts.duty).toBe(0);
  });

  it("keeps existing result mappings and excludes archived achievement duplicates", async () => {
    mocks.projectFindMany.mockResolvedValue([
      {
        id: "project-1",
        title: "完整课题名",
        shortTitle: "课题简称",
        code: "KT-001",
        status: "ONGOING",
        level: "PROVINCIAL",
      },
    ]);
    mocks.achievementFindMany.mockResolvedValue([
      { id: "achievement-1", title: "论文成果", type: "PAPER", year: 2026, level: "MUNICIPAL" },
    ]);
    mocks.taskFindMany.mockResolvedValue([
      { id: "task-1", title: "提交材料", status: "DOING", dueDate: new Date("2026-08-08Z") },
    ]);
    mocks.meetingFindMany.mockResolvedValue([
      { id: "meeting-1", title: "课题会议", meetingTime: new Date("2026-08-01T06:30:00Z") },
    ]);
    mocks.dutyFindMany.mockResolvedValue([
      { id: "duty-1", title: "轮派任务", date: new Date("2026-08-02Z"), dutyType: { name: "值班" } },
    ]);

    const results = await search("课题", ALL_ON);

    expect(mocks.achievementFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ archivedAt: null }),
      }),
    );
    expect(results.counts).toEqual({
      project: 1,
      achievement: 1,
      task: 1,
      meeting: 1,
      duty: 1,
      document: 0,
      student: 0,
      honor: 0,
      competition: 0,
    });
    expect(results.hits.map(({ kind, id, href }) => ({ kind, id, href }))).toEqual([
      { kind: "project", id: "project-1", href: "/projects/project-1" },
      { kind: "achievement", id: "achievement-1", href: "/achievements/achievement-1" },
      { kind: "task", id: "task-1", href: "/tasks" },
      { kind: "meeting", id: "meeting-1", href: "/meetings/meeting-1" },
      { kind: "duty", id: "duty-1", href: "/duties" },
    ]);
  });

  it("exposes document as a first-class search-hit kind", () => {
    expectTypeOf<SearchHit["kind"]>().toEqualTypeOf<
      | "project"
      | "achievement"
      | "task"
      | "meeting"
      | "duty"
      | "document"
      | "student"
      | "honor"
      | "competition"
    >();
  });

  it("班主任模块关闭时不查学生和荣誉", async () => {
    await search("张", { ...ALL_ON, advisor: false });

    expect(mocks.studentFindMany).not.toHaveBeenCalled();
    expect(mocks.honorFindMany).not.toHaveBeenCalled();
  });

  it("参赛模块关闭时不查参赛记录——「导航上没有、搜索却搜得到」是模块开关最容易漏的裂缝", async () => {
    await search("技能", { ...ALL_ON, competitions: false });

    expect(mocks.competitionEntryFindMany).not.toHaveBeenCalled();
  });
});
