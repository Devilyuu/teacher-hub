import ExcelJS from "exceljs";
import { logActivity } from "@/lib/activity";
import { formatDateOnly } from "@/lib/date";
import { isSameOriginRequest } from "@/lib/export/request";
import { getMenteeProjectDetail } from "@/lib/queries/mentees";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 毕业设计指导记录表（xlsx）。答辩季要交的那张表——**一名学生一个 sheet**。
 *
 * **老实说明**：学校发的是固定格式的 Word 表，这里先导 xlsx（字段齐、
 * 一人一块），使用者自己贴进学校模板。做 docx 模板填充要等拿到真实模板文件，
 * 不在本次范围——与其猜一个格式，不如把内容摆对。
 *
 * 只导**挂在这个项目上**的指导记录：学业、生涯那些谈话不属于毕设过程，
 * 混进去这张表就不是「毕设指导记录」了。
 *
 * 原生 form POST 不走 fetch：proxy.ts 对未登录的 /api/* 返回 307，
 * fetch 默认跟随重定向会把登录页 HTML 当成 xlsx 存下来。
 */
export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const projectId = form.get("projectId");
  if (typeof projectId !== "string" || projectId === "") {
    return Response.json({ error: "缺少项目标识" }, { status: 400 });
  }

  const project = await getMenteeProjectDetail(projectId);
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }
  if (project.records.length === 0) {
    return Response.json({ error: "这个项目还没有指导记录" }, { status: 400 });
  }

  const book = new ExcelJS.Workbook();
  book.creator = "高校教师智能工作台";
  book.created = new Date();

  // 没挂学生的项目也要能导：那就出一张「（未挂学生）」的表，
  // 而不是返回一个「没有学生」的错误——表还是要交的
  const targets =
    project.members.length > 0
      ? project.members.map((member) => ({
          id: member.menteeId,
          name: member.mentee.name,
        }))
      : [{ id: null as string | null, name: "（未挂学生）" }];

  // 导出按时间正序：交上去的记录表是按时间读的，
  // 而页面上倒序是因为最近那条最常看。两处不必一致
  const ordered = [...project.records].reverse();

  for (const target of targets) {
    // 点了名的只出自己的 + 全项目范围的（0 成员）；
    // 没挂学生时全都出
    const rows =
      target.id == null
        ? ordered
        : ordered.filter(
            (record) =>
              record.members.length === 0 ||
              record.members.some((member) => member.mentee.id === target.id),
          );

    // sheet 名不能带 : \ / ? * [ ]，也不能超过 31 字
    const safeName = target.name.replace(/[:\/?*[\]]/g, "·").slice(0, 28);
    const sheet = book.addWorksheet(safeName || "学生");

    sheet.columns = [
      { header: "序号", key: "index", width: 6 },
      { header: "日期", key: "date", width: 12 },
      { header: "类型", key: "type", width: 12 },
      { header: "指导内容", key: "content", width: 64 },
    ];
    sheet.getRow(1).font = { bold: true };

    // 表头上面压一块题目信息：交表的人要一眼看出这是谁的哪个题
    sheet.spliceRows(1, 0, [`学生：${target.name}`], [`题目：${project.title}`], [
      `类型：${project.kind.name}${project.schoolYear ? ` · ${project.schoolYear}` : ""}`,
    ], []);
    for (let row = 1; row <= 3; row += 1) sheet.getRow(row).font = { bold: true };

    rows.forEach((record, index) => {
      const added = sheet.addRow({
        index: index + 1,
        date: formatDateOnly(record.date),
        type: record.type.name,
        content: record.content,
      });
      // 指导内容常有换行，不自动换行的话整段挤成一行看不了
      added.getCell("content").alignment = { wrapText: true, vertical: "top" };
    });
  }

  const buffer = await book.xlsx.writeBuffer();

  await logActivity("MenteeProject", project.id, "导出毕设指导记录表", {
    sheetCount: targets.length,
    recordCount: project.records.length,
  });

  const filename = `${project.title}_指导记录表.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mentee-guidance.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
