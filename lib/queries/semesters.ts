import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";

/** 全部学期，新的在前。设置页列表、首页问候行、本周课表共用——同一请求只查一次 */
export const getSemesters = cache(getSemestersUncached);

function getSemestersUncached() {
  return prisma.semester.findMany({ orderBy: { startDate: "desc" } });
}
