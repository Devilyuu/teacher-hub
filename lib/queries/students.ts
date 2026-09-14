import "server-only";
import { prisma } from "@/lib/db";

/**
 * 班主任模块的读取层。页面只消费这里的结果，不各自拼 include——
 * 「名册怎么排、离班学生放哪」这类口径只在一处定。
 */

/** 班级列表（含归档）。下拉框和设置用 */
export function getClassGroups() {
  return prisma.classGroup.findMany({
    orderBy: [{ archivedAt: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      archivedAt: true,
      _count: { select: { students: true } },
    },
  });
}

/**
 * 解析当前操作的班级：URL 有 ?class= 按它找，没有取第一个未归档的班。
 * 返回 null = 一个班都没建，页面进入引导态。
 */
export async function resolveClassGroup(classParam: string | undefined) {
  if (classParam) {
    const picked = await prisma.classGroup.findUnique({
      where: { id: classParam },
      select: { id: true, name: true, archivedAt: true },
    });
    if (picked) return picked;
    // 参数指向不存在的班（书签过期）时静默落回默认班，别报错
  }
  return prisma.classGroup.findFirst({
    where: { archivedAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, archivedAt: true },
  });
}

/** 名册：在班的排前面，各按姓名排。矛盾关系两个方向都取 */
export function getRoster(classGroupId: string) {
  return prisma.student.findMany({
    where: { classGroupId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      studentNo: true,
      phone: true,
      parentName: true,
      parentPhone: true,
      dormRoom: true,
      internshipUnit: true,
      internshipContact: true,
      note: true,
      active: true,
      _count: { select: { recordMembers: true, honorMembers: true } },
      relationsA: {
        select: {
          id: true,
          note: true,
          resolvedAt: true,
          studentB: { select: { id: true, name: true } },
        },
      },
      relationsB: {
        select: {
          id: true,
          note: true,
          resolvedAt: true,
          studentA: { select: { id: true, name: true } },
        },
      },
    },
  });
}

export function getStudentDetail(id: string) {
  return prisma.student.findUnique({
    where: { id },
    include: {
      classGroup: { select: { id: true, name: true } },
      relationsA: {
        select: {
          id: true,
          note: true,
          resolvedAt: true,
          studentB: { select: { id: true, name: true } },
        },
      },
      relationsB: {
        select: {
          id: true,
          note: true,
          resolvedAt: true,
          studentA: { select: { id: true, name: true } },
        },
      },
      recordMembers: {
        orderBy: { record: { date: "desc" } },
        select: {
          record: {
            select: {
              id: true,
              date: true,
              content: true,
              type: { select: { name: true } },
            },
          },
        },
      },
      honorMembers: {
        orderBy: { honor: { awardedAt: "desc" } },
        select: {
          honor: {
            select: {
              id: true,
              title: true,
              level: true,
              awardedAt: true,
              dateText: true,
              datePrecision: true,
            },
          },
        },
      },
    },
  });
}

/** 勾名单列表。进行中在前、新建在前；勾数在行里显示 X/N */
export function getChecklists(classGroupId: string) {
  return prisma.rosterChecklist.findMany({
    where: { classGroupId },
    orderBy: [{ closedAt: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      dueDate: true,
      note: true,
      closedAt: true,
      createdAt: true,
      _count: { select: { checkmarks: true } },
    },
  });
}

/** 单个勾名单：勾过的集合 + 在班学生全表，未交 = 差集（在页面里算） */
export function getChecklistDetail(id: string) {
  return prisma.rosterChecklist.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      dueDate: true,
      note: true,
      closedAt: true,
      classGroupId: true,
      classGroup: { select: { id: true, name: true } },
      checkmarks: { select: { studentId: true } },
    },
  });
}

export function getHonors(classGroupId: string) {
  return prisma.studentHonor.findMany({
    where: { classGroupId },
    // 有日期的按日期倒序；没日期的（刚记的线索）浮最前免得被忘掉
    orderBy: [{ awardedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      level: true,
      issuer: true,
      isCollective: true,
      awardedAt: true,
      dateText: true,
      datePrecision: true,
      note: true,
      members: { select: { student: { select: { id: true, name: true } } } },
      _count: { select: { attachments: true } },
    },
  });
}

export function getHonorDetail(id: string) {
  return prisma.studentHonor.findUnique({
    where: { id },
    select: {
      id: true,
      updatedAt: true,
      classGroupId: true,
      classGroup: { select: { id: true, name: true } },
      title: true,
      level: true,
      issuer: true,
      isCollective: true,
      awardedAt: true,
      dateText: true,
      datePrecision: true,
      note: true,
      members: { select: { student: { select: { id: true, name: true } } } },
      attachments: {
        orderBy: { uploadedAt: "desc" },
        select: {
          id: true,
          filename: true,
          size: true,
          mimeType: true,
          uploadedAt: true,
        },
      },
    },
  });
}

export function getRecordTypes() {
  return prisma.studentRecordType.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      note: true,
      _count: { select: { records: true } },
    },
  });
}

export function getRecords(classGroupId: string) {
  return prisma.studentRecord.findMany({
    where: { classGroupId },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    select: {
      id: true,
      date: true,
      content: true,
      type: { select: { id: true, name: true } },
      members: { select: { student: { select: { id: true, name: true } } } },
    },
  });
}

/**
 * 建班时顺手补齐的记录类型。**不在页面加载时补**——GET 不该写库；
 * 也不做成迁移里的 INSERT——字典可删，删了不该在下次迁移时复活。
 */
export const DEFAULT_RECORD_TYPE_NAMES = ["谈话", "班会", "事件"] as const;
