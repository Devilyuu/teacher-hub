import ExcelJS from "exceljs";
import { logActivity } from "@/lib/activity";
import { isSameOriginRequest } from "@/lib/export/request";
import {
  CASE_INDEX_COLUMNS,
  buildCaseIndexRows,
  summarizeCaseIndex,
} from "@/lib/mentees";
import { getMenteeCaseIndexSources } from "@/lib/queries/mentees";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 学生项目案例索引（xlsx，规格 §8 第 4 项）。评优、绩效、职称时翻的那张表。
 *
 * 列头照抄仓库里那张一直没填起来的 `索引样式/学生项目案例索引.md`——
 * 那张空表就是这份导出的形状，不重新发明。口径在 `buildCaseIndexRows`（有单测）。
 *
 * **导的是全部批次**，含已归档的：评职称要的是这几年带过的所有作品，
 * 不是列表页上当前选中的那一届。按钮上写明了「全部批次」，
 * 所以不存在「界面上 5 条、导出来 30 条」那种对不上。
 *
 * 原生 form POST 不走 fetch：proxy.ts 对未登录的 /api/* 返回 307，
 * fetch 默认跟随重定向会把登录页 HTML 当成 xlsx 存下来。
 * 审计走 ActivityLog，不给 ExportKind 加不可回滚的枚举值（3.8 的先例）。
 */
export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const projects = await getMenteeCaseIndexSources();
  if (projects.length === 0) {
    return Response.json({ error: "还没有学生项目" }, { status: 400 });
  }

  const book = new ExcelJS.Workbook();
  book.creator = "高校教师智能工作台";
  book.created = new Date();

  const sheet = book.addWorksheet("案例索引");
  sheet.columns = CASE_INDEX_COLUMNS.map((column) => ({ ...column }));
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  for (const row of buildCaseIndexRows(projects)) {
    const added = sheet.addRow(row);
    // 题目和结项原文常常很长，不换行就只看得见半截
    added.alignment = { wrapText: true, vertical: "top" };
  }

  // 第二页只数不评：每个类型几个、几个进了台账
  const summary = book.addWorksheet("按类型");
  summary.columns = [
    { header: "项目类型", key: "kind", width: 16 },
    { header: "项目数", key: "total", width: 10 },
    { header: "已引用为成果", key: "adopted", width: 14 },
  ];
  summary.getRow(1).font = { bold: true };
  for (const row of summarizeCaseIndex(projects)) summary.addRow(row);

  const buffer = await book.xlsx.writeBuffer();

  // 没有单个实体可指，entityId 固定（同全库备份的 "full-json"）
  await logActivity("MenteeProject", "case-index", "导出学生项目案例索引", {
    projectCount: projects.length,
  });

  const filename = "学生项目案例索引.xlsx";
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mentee-case-index.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
