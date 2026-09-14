import "server-only";
import { prisma } from "@/lib/db";

/** 全部学期，新的在前。设置页列表和首页问候行共用 */
export function getSemesters() {
  return prisma.semester.findMany({ orderBy: { startDate: "desc" } });
}
