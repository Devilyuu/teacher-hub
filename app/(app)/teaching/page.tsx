import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, Settings2 } from "lucide-react";
import { InboxTrayArt } from "@/components/empty-art";
import { Button } from "@/components/ui/button";
import { formatDateOnly } from "@/lib/date";
import { prisma } from "@/lib/db";
import { teachingAppUrl } from "@/lib/integrations";
import { ModuleDisabledNotice } from "@/components/module-disabled";
import { isModuleEnabled } from "@/lib/module-settings";
import { TeachingImports, type TeachingImportRow } from "./teaching-imports";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "教学" };

/**
 * 教学枢纽（规格 §7.6）。
 *
 * **不是 iframe。** 备课系统独立部署、独立数据库、独立登录，出故障时这一页
 * 仍然能打开、回流历史仍然能看。这里只做两件事：把人送过去，和收回来的教案。
 */
export default async function TeachingPage() {
  // 模块关了只影响界面显示；教案回流接口（/api/teaching/import）照常收，
  // 数据不丢——重新启用后回流历史都在
  if (!(await isModuleEnabled("teaching"))) {
    return <ModuleDisabledNotice moduleKey="teaching" />;
  }

  const appUrl = teachingAppUrl();

  // 回流历史来自本地库：备课系统挂了，这一页照常打开（规格 §8）
  // 同一门课的几个学期挨在一起，新的在前。规范形式 `YYYY-YYYY 第X学期` 的字典序
  // 就是时间序（学年是数字，一 U+4E00 < 二 U+4E8C），所以 term desc 不需要映射表
  const imports = await prisma.teachingImport.findMany({
    orderBy: [
      { status: "asc" },
      { courseName: "asc" },
      { term: "desc" },
      { receivedAt: "desc" },
    ],
    select: {
      id: true,
      title: true,
      courseName: true,
      term: true,
      finishedAt: true,
      receivedAt: true,
      status: true,
      failureReason: true,
      achievementId: true,
      _count: { select: { attachments: true } },
    },
  });

  const rows: TeachingImportRow[] = imports.map((item) => ({
    id: item.id,
    title: item.title,
    courseName: item.courseName,
    term: item.term,
    // 纯日期列走 lib/date.ts；用 date-fns 的 format 会按本地时区解释、差一天
    finishedAtText: item.finishedAt ? formatDateOnly(item.finishedAt) : null,
    receivedAt: item.receivedAt,
    status: item.status,
    failureReason: item.failureReason,
    achievementId: item.achievementId,
    attachmentCount: item._count.attachments,
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="page-title">教学</h1>
        <p className="measure text-muted-foreground">
          备课在
          <span className="text-foreground">独立的备课系统</span>
          里做，做完的教案回流到这里；你确认之后，它才会成为成果。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">智能备课系统</h2>

        <div className="surface space-y-4 p-6">
          {appUrl ? (
            <>
              <p className="measure text-sm leading-relaxed text-muted-foreground">
                课程、教案、课件在那边完成。它有自己的登录，第一次过去需要单独登一次。
              </p>
              <Button
                render={
                  <a href={appUrl} target="_blank" rel="noopener noreferrer" />
                }
                nativeButton={false}
              >
                <ExternalLink className="size-4" aria-hidden />
                打开备课系统
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-sm font-medium">还没接上备课系统</p>
                <p className="measure text-sm leading-relaxed text-muted-foreground">
                  它是独立部署的另一套系统。在服务器的{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    .env
                  </code>{" "}
                  里填上
                  <code className="mx-1 rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    TEACHING_APP_URL
                  </code>
                  之后，这里会出现打开入口。
                </p>
              </div>
              <Button
                render={<Link href="/settings" />}
                nativeButton={false}
                variant="outline"
              >
                <Settings2 className="size-4" aria-hidden />
                查看配置状态
              </Button>
            </>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">教案回流</h2>

        {rows.length > 0 ? (
          <>
            <TeachingImports rows={rows} />
            <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
              回流的内容
              <span className="text-foreground">不会自动变成成果</span>
              ，也不进成果台账和任何统计——教案是按周产出的，自动入库会让待核实队列
              瞬间失去意义。点「引用为成果」，它才进台账。
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-3 rounded-3xl bg-well px-6 py-10 text-center">
            {/* 空状态插画统一走 empty-art（手绘同笔触），不混 lucide 线稿 */}
            <InboxTrayArt className="size-12 text-muted-foreground/60" />
            <p className="text-sm font-medium">还没有回流记录</p>
            <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
              备课系统接通后，那边做完的教案会带着 DOCX 一起送到这里。
            </p>
            <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
              回流的内容
              <span className="text-foreground">不会自动变成成果</span>
              ，也不进成果台账和任何统计——教案是按周产出的，自动入库会让待核实队列
              瞬间失去意义。你在这一页点「引用为成果」，它才进台账。
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
