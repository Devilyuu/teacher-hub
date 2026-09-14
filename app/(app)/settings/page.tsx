import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatDateOnly, todayAsDateOnly } from "@/lib/date";
import {
  integrationStatuses,
  type IntegrationStatus,
} from "@/lib/integrations";
import { getEnabledModules } from "@/lib/module-settings";
import { MODULES, moduleForPath } from "@/lib/modules";
import { NAV_ITEMS } from "@/lib/nav";
import { getSemesters } from "@/lib/queries/semesters";
import { semesterStatus, teachingWeek } from "@/lib/semester";
import { BackupForm } from "./backup-form";
import { ModulesPanel, type ModuleRowData } from "./modules-panel";
import { SemesterPanel, type SemesterRowData } from "./semester-panel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "设置" };

/**
 * 配置状态徽章。
 *
 * **刻意不用绿色**：绿色在本工具里有确定含义（结题要求已齐备，
 * `components/health.tsx` 的六个语义色之一）。一个「已配置」的绿角标会让
 * 看板上的绿点失去信号价值——这里用实心/描边的对比就够了。
 */
function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={
        configured
          ? "shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground"
          : "shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground"
      }
    >
      {configured ? "已配置" : "尚未配置"}
    </span>
  );
}

function IntegrationRow({ status }: { status: IntegrationStatus }) {
  return (
    <div className="space-y-1.5 border-b border-border/40 px-5 py-4 last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{status.label}</span>
        <StatusBadge configured={status.configured} />
        {status.detail ? (
          <span className="truncate text-xs text-muted-foreground">
            {status.detail}
          </span>
        ) : null}
      </div>

      <p className="measure text-xs leading-relaxed text-muted-foreground">
        {status.hint}
      </p>

      {status.configured ? null : (
        <p className="measure text-xs text-muted-foreground">
          <span className="text-foreground">{status.usedBy}</span>
          {" 才用得到。届时在服务器 .env 里补上 "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
            {status.missing.join("、")}
          </code>
        </p>
      )}
    </div>
  );
}

export default async function SettingsPage() {
  const [profile, semesters, statuses, enabledModules, timetableCount] = await Promise.all([
    prisma.profile.findFirst(),
    getSemesters(),
    Promise.resolve(integrationStatuses()),
    getEnabledModules(),
    prisma.timetableSlot.count(),
  ]);

  const moduleRows: ModuleRowData[] = MODULES.map((module) => ({
    key: module.key,
    label: module.label,
    description: module.description,
    enabled: enabledModules[module.key],
  }));
  // 一级入口计数的两半：骨架项（不可关）+ 占一级位的可选模块。
  // 「轮派」是「日常」下的二级 tab，不占一级位，所以不在 topLevelKeys 里
  const fixedNavCount = NAV_ITEMS.filter(
    (item) => moduleForPath(item.href) == null,
  ).length;
  const topLevelModuleKeys = NAV_ITEMS.flatMap((item) => {
    const key = moduleForPath(item.href);
    return key == null ? [] : [key];
  });

  // 周次口径只有 lib/semester.ts 一处，这里算好字符串传给客户端组件
  const today = todayAsDateOnly();
  const status = semesterStatus(semesters, today);
  const semesterRows: SemesterRowData[] = semesters.map((semester) => {
    const week = teachingWeek(semester.startDate, today);
    const started = semester.startDate.getTime() <= today.getTime();
    return {
      id: semester.id,
      name: semester.name,
      startText: formatDateOnly(semester.startDate),
      hint: week != null ? `第 ${week} 教学周` : started ? "已结束" : "未开学",
      current: status?.kind === "week" && status.name === semester.name,
    };
  });

  const byKey = (key: IntegrationStatus["key"]) =>
    statuses.filter((item) => item.key === key);

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="page-title">设置</h1>
        <p className="measure text-muted-foreground">
          档案、外部系统和备份。
          <span className="text-foreground">密钥一律只存服务器环境变量</span>
          ，这里只显示配没配，不显示值、也不能在线修改。
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">个人档案</h2>
        <Link
          href="/profile"
          className="surface-interactive flex items-center gap-4 p-5 text-left"
        >
          <div className="min-w-0 flex-1 space-y-1">
            {profile ? (
              <>
                <p className="text-sm font-medium">
                  {profile.name}
                  {profile.currentTitle ? (
                    <span className="ml-2 font-normal text-muted-foreground">
                      {profile.currentTitle}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile.unit}
                  {profile.currentTitleSince
                    ? ` · 任现职自 ${formatDateOnly(profile.currentTitleSince)}`
                    : " · 未填现职称取得日期，职称口径无法按任现职以来过滤"}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">还没填</p>
                <p className="text-xs text-muted-foreground">
                  申报表里的姓名和承担单位取自这里，导出前先填一次
                </p>
              </>
            )}
          </div>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">学期</h2>
        <SemesterPanel rows={semesterRows} />
        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          开学日就是第一教学周的第一天，首页问候行按它推算「第 N 教学周」。
          每学期开学前来设一条即可；周次超过 25 周会自动不再显示——
          那多半是假期里忘了设新学期，
          <span className="text-foreground">
            宁可不显示，也不显示一个看起来精确的错数
          </span>
          。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">课表</h2>
        <Link
          href="/settings/timetable"
          className="surface-interactive flex items-center gap-4 p-5 text-left"
        >
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">
              {timetableCount > 0 ? `已导入 ${timetableCount} 条` : "还没导入"}
            </p>
            <p className="text-xs text-muted-foreground">
              上传教务系统导出的课表，首页显示本周哪几个半天有课，月历上铺上上课的日子
            </p>
          </div>
          <ChevronRight
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden
          />
        </Link>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">功能模块</h2>
        <ModulesPanel
          rows={moduleRows}
          fixedNavCount={fixedNavCount}
          topLevelKeys={topLevelModuleKeys}
        />
        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          按自己的工作勾选。
          <span className="text-foreground">关闭只是隐藏，不删除任何数据</span>
          ——直接访问被关模块的地址会看到提示页，重新勾上一切照旧。
          首页、日常、科研、成果是平台骨架，不可关闭。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">外部系统</h2>
        <div className="surface">
          {byKey("teaching").map((status) => (
            <IntegrationRow key={status.key} status={status} />
          ))}
        </div>
        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          备课系统
          <span className="text-foreground">独立部署、独立数据库</span>
          ，出故障不会影响本平台。两边共用一套视觉规范，跳过去不该有换了个产品的感觉。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">AI 与转写</h2>
        <div className="surface">
          {[...byKey("asr"), ...byKey("minutes")].map((status) => (
            <IntegrationRow key={status.key} status={status} />
          ))}
        </div>
        <p className="measure px-1 text-xs leading-relaxed text-muted-foreground">
          每次上传都要单独确认后，音频才会发送到腾讯云完成一次识别请求；请求完成后本系统不保留云端副本。
          纪要确认后立即删除本机原音频；成功转写但未确认时第 6 天提醒、第 7
          天删除，转写失败不自动删除。
          <span className="text-foreground">AI 只产草稿</span>
          ，纪要、决议和待办都要人工确认后才成为正式记录。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">数据备份与维护</h2>
        <div className="surface">
          <div className="space-y-1.5 border-b border-border/40 px-5 py-4">
            <p className="text-sm font-medium">服务器自动备份</p>
            <p className="measure text-xs leading-relaxed text-muted-foreground">
              每天 03:20 由宿主机 cron 执行，数据库 dump
              与附件原件一起打包，滚动保留 14 份。 恢复走{" "}
              <code className="font-mono text-[11px]">scripts/restore.sh</code>
              ， 先恢复到临时库核对数量再切换。
              <span className="text-foreground">
                没恢复验证过的备份不算备份
              </span>
              ——每隔几个月真恢复一次。
            </p>
          </div>

          {byKey("maintenance").map((status) => (
            <IntegrationRow key={status.key} status={status} />
          ))}

          <div className="space-y-3 px-5 py-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">全库 JSON 导出</p>
              <p className="measure text-xs leading-relaxed text-muted-foreground">
                一次下载拿走全部业务数据，防的是「哪天这个系统不维护了，东西还能搬走」。
                纯文本，不依赖 PostgreSQL 版本，用任何语言都能读。
                <span className="text-foreground">不含附件原件</span>
                ——那些在上面那份服务器自动备份里，两者靠文件名对应。
                因为它一次带走所有真实履历，下载前要重新输入一次登录口令。
              </p>
            </div>
            <BackupForm />
          </div>
        </div>
      </section>
    </div>
  );
}
