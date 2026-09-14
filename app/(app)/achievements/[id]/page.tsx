import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { updateAchievement } from "@/app/(app)/achievements/actions";
import { AttachmentPanel } from "@/components/attachment-panel";
import { formatPerfRules } from "@/lib/perf-rules";
import { achievementSources } from "@/lib/outcomes/achievement-source";
import { outcomeProjectHref } from "@/lib/outcomes/links";
import { getAchievementDetail } from "@/lib/queries/achievements";
import { getPerfOptions } from "@/lib/queries/perf-categories";
import { getPromotionOptions } from "@/lib/queries/promotion-categories";
import { canPreviewInline } from "@/lib/storage";
import { AchievementForm } from "../achievement-form";
import { DeleteAchievementButton } from "../delete-achievement-button";
import { SchoolRewardPanel } from "@/components/school-reward-panel";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const achievement = await getAchievementDetail((await params).id);
  return { title: achievement && !achievement.archivedAt ? achievement.title : "成果" };
}

/**
 * 回到列表的链接。
 *
 * **必须带回原来的筛选**：用户在「待核实」视图点进来改完，返回时如果掉回
 * 光秃秃的 `/achievements`，看到的是全部 73 条台账——进度条不见了
 * （它只在待核实视图显示），刚清完的那条也还在列表里，看起来像是没保存上。
 *
 * 路径是硬编码的 `/achievements`，只把查询串原样带回去，所以不存在开放重定向；
 * 列表页对不认识的参数一律忽略。
 */
function backHref(params: SearchParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value !== "") query.set(key, value);
  }
  const search = query.toString();
  return search ? `/achievements?${search}` : "/achievements";
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function AchievementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const achievement = await getAchievementDetail((await params).id);
  if (!achievement) notFound();

  const back = backHref(await searchParams);
  if (achievement.archivedAt) {
    if (achievement.legacyProjectPerformance) {
      permanentRedirect(
        outcomeProjectHref(achievement.legacyProjectPerformance.projectId, back),
      );
    }
    notFound();
  }

  const promotionOptions = await getPromotionOptions();
  const perfOptions = await getPerfOptions();
  const update = updateAchievement.bind(null, achievement.id);
  const sources = achievementSources(achievement);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        href={back}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        {back === "/achievements" ? "成果库" : "回到刚才的列表"}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 pt-2">
        <h1 className="page-title min-w-0 flex-1">{achievement.title}</h1>
        <DeleteAchievementButton
          achievementId={achievement.id}
          title={achievement.title}
          attachmentCount={achievement.attachments.length}
        />
      </header>

      {/* 来源紧跟标题：它回答的是「这条哪来的」，属于身份信息不是内容。
          走 well 一行而不是白卡——白卡留给正式内容（CLAUDE.md 视觉语言）。
          绝大多数成果是直接建的，没有来源，这一段整块不出现 */}
      {sources.length > 0 ? (
        <div className="space-y-1 rounded-2xl bg-well px-5 py-3">
          {sources.map((source) => (
            <p key={source.key} className="text-sm">
              <span className="text-muted-foreground">{source.kindLabel}</span>
              <span className="px-2 text-muted-foreground">·</span>
              <Link href={source.href} className="underline underline-offset-4">
                {source.label}
              </Link>
              {source.hint ? (
                <span className="ml-2 text-xs text-muted-foreground">
                  {source.hint}
                </span>
              ) : null}
            </p>
          ))}
        </div>
      ) : null}

      {achievement.links.length > 0 ? (
        <section className="surface space-y-2 p-5">
          <h2 className="text-sm font-medium">已挂接的结题要求</h2>
          <ul className="space-y-2">
            {achievement.links.map((link) => (
              <li key={link.id} className="text-sm">
                <Link
                  href={outcomeProjectHref(
                    link.requirement.project.id,
                    back,
                  )}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {link.requirement.project.shortTitle ?? link.requirement.project.title}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">
                  {link.isQualified ? "已确认达标" : "未确认达标"}
                </span>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                  {link.requirement.rawText}
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* 两套口径的规则各占一块，并排显示但互不换算——
          左边是人事处评职称用的，右边是二级学院分钱用的（CLAUDE.md 第 11 条） */}
      {achievement.promotionCategory ? (
        <section className="surface space-y-1 p-5">
          <h2 className="text-sm font-medium">
            职称量化 · {achievement.promotionCategory.year} 年度
          </h2>
          <p className="text-sm">
            {achievement.promotionCategory.code} {achievement.promotionCategory.minorIndicator}
            <span className="ml-2 text-xs text-muted-foreground">
              {achievement.promotionCategory.majorIndicator}
              {achievement.promotionCategory.cap == null
                ? ""
                : ` · 本栏上限 ${achievement.promotionCategory.cap} 分`}
            </span>
          </p>
          {/* 赋分细则原样显示，不做任何解析——分数由人对着它自己填 */}
          <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
            {achievement.promotionCategory.scoringRule}
          </p>
          {achievement.promotionCategory.remark ? (
            <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              备注：{achievement.promotionCategory.remark}
            </p>
          ) : null}
          {achievement.promotionScore != null ? (
            <p className="pt-1 text-sm">
              本条已填职称分{" "}
              <span className="font-medium tabular-nums">
                {String(achievement.promotionScore)}
              </span>
            </p>
          ) : null}
        </section>
      ) : achievement.promotionScore != null ? (
        // 填了职称分却没挂指标。**这一块必须有**——否则详情页上关于职称的
        // 一切都不显示，用户填过的那个分数像是石沉大海，
        // 更看不出这条为什么进不了职称口径。只提示，不自动补挂
        <section className="surface space-y-1 p-5">
          <h2 className="text-sm font-medium">职称量化</h2>
          <p className="text-sm">
            已填职称分{" "}
            <span className="font-medium tabular-nums">{String(achievement.promotionScore)}</span>
            ，但没有挂职称指标。
          </p>
          <p className="text-xs leading-relaxed text-[var(--h-amber-fg)]">
            职称口径按「挂没挂上人事处的二级指标」过滤，不看分数——
            这条现在进不了职称口径，也不会计入职称量化分合计。
            要计入就编辑本条，挂上对应指标。
          </p>
        </section>
      ) : null}

      {achievement.perfCategory ? (
        <section className="surface space-y-1 p-5">
          <h2 className="text-sm font-medium">
            绩效分类 · {achievement.perfCategory.year} 年度
          </h2>
          <p className="text-sm">
            {achievement.perfCategory.majorCategory} / {achievement.perfCategory.minorCategory}
          </p>
          {/* 规则原样显示，不做任何解析——分数由人对着它自己填。
              与行内订正共用 formatPerfRules，两处显示口径必须一致 */}
          <p className="text-xs text-muted-foreground">
            {formatPerfRules(achievement.perfCategory)}
          </p>
          {achievement.perfCategory.remark ? (
            <p className="text-xs text-muted-foreground">
              备注：{achievement.perfCategory.remark}
            </p>
          ) : null}
        </section>
      ) : null}

      <SchoolRewardPanel
        target={{ kind: "ACHIEVEMENT", id: achievement.id }}
        decisions={achievement.schoolRewards.map((decision) => ({
          id: decision.id,
          approvedAt: decision.approvedAt,
          batch: decision.batch,
          domain: decision.domain,
          awardItem: decision.awardItem,
          awardLevel: decision.awardLevel,
          awardAmountYuan: decision.awardAmountYuan?.toString() ?? null,
          evidenceRef: decision.evidenceRef,
          note: decision.note,
        }))}
      />

      <section className="space-y-3">
        <h2 className="px-1 text-sm font-medium">支撑材料</h2>
        <AttachmentPanel
          owner={{ kind: "achievement", id: achievement.id }}
          attachments={achievement.attachments.map((attachment) => ({
            id: attachment.id,
            kind: attachment.kind,
            code: attachment.code,
            filename: attachment.filename,
            size: attachment.size,
            mimeType: attachment.mimeType,
            note: attachment.note,
            uploadedAt: attachment.uploadedAt,
            // 能否内联预览由服务端判定，客户端组件不重复一份类型白名单
            previewable: canPreviewInline(attachment.mimeType),
          }))}
        />
      </section>

      <AchievementForm
        action={update}
        submitLabel="保存"
        // 保存后字段区靠它重挂，理由见 AchievementForm 里那段注释
        dataVersion={achievement.updatedAt.toISOString()}
        promotionOptions={promotionOptions}
        perfOptions={perfOptions}
        defaults={{
          type: achievement.type,
          title: achievement.title,
          status: achievement.status,
          authorPosition: achievement.authorPosition,
          ownerRole: achievement.ownerRole,
          level: achievement.level,
          journalName: achievement.journalName,
          journalLevel: achievement.journalLevel,
          indexedBy: achievement.indexedBy,
          wordCount: achievement.wordCount,
          completedAt: achievement.completedAt,
          publishedAt: achievement.publishedAt,
          dateText: achievement.dateText,
          datePrecision: achievement.datePrecision,
          tags: achievement.tags,
          evidenceRef: achievement.evidenceRef,
          obsidianPath: achievement.obsidianPath,
          externalRef: achievement.externalRef,
          promotionCategoryId: achievement.promotionCategoryId,
          perfCategoryId: achievement.perfCategoryId,
          // Decimal 过不了 Server Component 边界
          promotionScore:
            achievement.promotionScore == null ? null : Number(achievement.promotionScore),
          declaredScore:
            achievement.declaredScore == null ? null : Number(achievement.declaredScore),
          isVerified: achievement.isVerified,
          note: achievement.note,
        }}
      />
    </div>
  );
}
