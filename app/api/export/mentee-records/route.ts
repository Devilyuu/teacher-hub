import ExcelJS from "exceljs";
import { logActivity } from "@/lib/activity";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { isSameOriginRequest } from "@/lib/export/request";
import { getMenteeRecords } from "@/lib/queries/mentees";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 学业导师指导记录汇总表（xlsx）。学期末那张「导师工作记录表」的原料——
 * 平时一句一句攒在这里，交表时按学期筛一下导出来。
 *
 * 筛选条件**照搬页面上的那一组 URL 参数**，所以导出的永远是屏幕上看到的那些行。
 * 两边各写一套筛选，早晚出现「界面上 12 条、导出来 30 条」。
 *
 * 审计走 ActivityLog 而不给 ExportKind 加枚举值——枚举加了不可回滚，
 * 3.8 全库备份与班主任荣誉导出都立过这个先例。
 *
 * 原生 form POST（见 records-filter.tsx），不走 fetch：
 * proxy.ts 对未登录的 /api/* 返回 307，fetch 默认跟随重定向会把登录页 HTML
 * 当成 xlsx 存下来，而用户毫不知情。
 */
export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  if (!isSameOriginRequest(request)) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" && value !== "" ? value : undefined;
  };

  const batchId = text("batchId");
  if (!batchId) {
    return Response.json({ error: "缺少批次标识" }, { status: 400 });
  }

  const batch = await prisma.menteeBatch.findUnique({
    where: { id: batchId },
    select: { id: true, name: true },
  });
  if (!batch) {
    return Response.json({ error: "批次不存在" }, { status: 404 });
  }

  // 纯日期列按 UTC 解释，构造一律走 lib/date.ts 的口径；
  // `new Date("2026-03-01")` 正好是 UTC 午夜，与 @db.Date 对得上
  const dateParam = (key: string) => {
    const raw = text(key);
    if (!raw) return undefined;
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  };

  const menteeId = text("menteeId");
  const typeId = text("typeId");
  const from = dateParam("from");
  const to = dateParam("to");

  const records = await getMenteeRecords(batch.id, { menteeId, typeId, from, to });
  if (records.length === 0) {
    return Response.json({ error: "这个条件下没有记录可导出" }, { status: 400 });
  }

  const book = new ExcelJS.Workbook();
  book.creator = "高校教师智能工作台";
  book.created = new Date();

  // 不做花哨排版——这份表交上去多半还要按学校模板再调，数据摆对比样式重要
  const sheet = book.addWorksheet("指导记录");
  sheet.columns = [
    { header: "序号", key: "index", width: 6 },
    { header: "日期", key: "date", width: 12 },
    { header: "类型", key: "type", width: 12 },
    { header: "学生", key: "members", width: 20 },
    { header: "指导内容", key: "content", width: 60 },
  ];
  sheet.getRow(1).font = { bold: true };

  // 导出按时间正序：交上去的记录表是按时间读的，
  // 而页面上倒序是因为最近的那条最常要看。两处不必一致
  const ordered = [...records].reverse();
  ordered.forEach((record, index) => {
    const row = sheet.addRow({
      index: index + 1,
      date: formatDateOnly(record.date),
      type: record.type.name,
      members:
        record.members.length > 0
          ? record.members.map((member) => member.mentee.name).join("、")
          : "（全批）",
      content: record.content,
    });
    // 指导内容常有换行，不自动换行的话整段挤成一行看不了
    row.getCell("content").alignment = { wrapText: true, vertical: "top" };
  });

  const buffer = await book.xlsx.writeBuffer();

  await logActivity("MenteeBatch", batch.id, "导出指导记录汇总表", {
    recordCount: records.length,
    filtered: Boolean(menteeId || typeId || from || to),
  });

  const filename = `${batch.name}_指导记录汇总.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="mentee-records.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
