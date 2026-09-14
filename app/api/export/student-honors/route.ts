import ExcelJS from "exceljs";
import { logActivity } from "@/lib/activity";
import { prisma } from "@/lib/db";
import { isSameOrigin } from "@/lib/export/request";
import { formatDateByPrecision } from "@/lib/format";
import { LEVEL_LABELS } from "@/lib/labels";
import { getHonors } from "@/lib/queries/students";
import { sessionGuard } from "@/lib/server-auth";

/**
 * 班级荣誉汇总表（xlsx）。评优申报的「列一张表」那半件事。
 *
 * 审计走 ActivityLog 而不给 ExportKind 加枚举值——枚举加了不可回滚，
 * 3.8 全库备份立过这个先例；这里的导出没有行快照诉求，日志足够。
 */
export async function POST(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const requestUrl = new URL(request.url);
  if (!isSameOrigin(requestUrl, request.headers.get("origin"))) {
    return Response.json({ error: "拒绝跨站导出请求" }, { status: 403 });
  }

  const form = await request.formData();
  const classGroupId = form.get("classGroupId");
  if (typeof classGroupId !== "string" || classGroupId === "") {
    return Response.json({ error: "缺少班级标识" }, { status: 400 });
  }

  const classGroup = await prisma.classGroup.findUnique({
    where: { id: classGroupId },
    select: { id: true, name: true },
  });
  if (!classGroup) {
    return Response.json({ error: "班级不存在" }, { status: 404 });
  }

  const honors = await getHonors(classGroup.id);
  if (honors.length === 0) {
    return Response.json({ error: "还没有荣誉可导出" }, { status: 400 });
  }

  const book = new ExcelJS.Workbook();
  book.creator = "高校教师智能工作台";
  book.created = new Date();

  // 不做花哨排版——这份表交上去多半还要按对方模板再调，数据摆对比样式重要
  const sheet = book.addWorksheet("班级荣誉");
  sheet.columns = [
    { header: "序号", key: "index", width: 6 },
    { header: "荣誉名称", key: "title", width: 44 },
    { header: "级别", key: "level", width: 10 },
    { header: "获奖学生", key: "members", width: 24 },
    { header: "颁发单位", key: "issuer", width: 24 },
    { header: "获奖时间", key: "date", width: 14 },
    { header: "奖状", key: "certificates", width: 8 },
    { header: "备注", key: "note", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };

  honors.forEach((honor, index) => {
    sheet.addRow({
      index: index + 1,
      title: honor.title,
      level: LEVEL_LABELS[honor.level],
      members: honor.isCollective
        ? "（集体）"
        : honor.members.map((member) => member.student.name).join("、"),
      issuer: honor.issuer ?? "",
      // 模糊日期按精度渲染原文，不硬造精确日期（铁律 8）
      date: formatDateByPrecision(honor.awardedAt, honor.datePrecision, honor.dateText),
      certificates: honor._count.attachments > 0 ? `${honor._count.attachments} 份` : "缺",
      note: honor.note ?? "",
    });
  });

  const buffer = await book.xlsx.writeBuffer();

  await logActivity("ClassGroup", classGroup.id, "导出班级荣誉汇总表", {
    honorCount: honors.length,
  });

  const filename = `${classGroup.name}_班级荣誉汇总.xlsx`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="honors.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
