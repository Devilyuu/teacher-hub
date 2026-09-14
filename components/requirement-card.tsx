import { AlertTriangle, CircleCheck, CircleDashed, FileText, Info } from "lucide-react";
import Link from "next/link";
import {
  LinkAchievementForm,
  LinkMaterialForm,
  MaterialQualifyControl,
  QualifyControl,
  UploadRequirementReportForm,
  UnlinkButton,
  UnlinkMaterialButton,
  type LinkCandidate,
  type MaterialCandidate,
} from "@/app/(app)/projects/[id]/link-controls";
import { EditRequirement } from "@/app/(app)/projects/[id]/requirement-editor";
import { checkConstraints } from "@/lib/constraints";
import type { RequirementGap } from "@/lib/gap";
import { formatDate, formatFileSize } from "@/lib/format";
import {
  achievementStatusLabel,
  ACHIEVEMENT_STATUS_LABELS,
  ACHIEVEMENT_TYPE_LABELS,
  ATTACHMENT_KIND_LABELS,
} from "@/lib/labels";
import { parseConstraints } from "@/lib/schemas/requirement";
import type {
  AchievementType,
  AttachmentKind,
  FundingType,
  Level,
} from "@/lib/generated/prisma/enums";

type LinkedAchievement = {
  id: string;
  isQualified: boolean;
  qualifyNote: string | null;
  achievement: {
    id: string;
    title: string;
    type: AchievementType;
    status: keyof typeof ACHIEVEMENT_STATUS_LABELS;
    authorPosition: number | null;
    wordCount: number | null;
    indexedBy: string | null;
    journalLevel: Level | null;
  };
};

/** 关联到本要求项的课题级材料（规格 6.4） */
type LinkedMaterial = {
  id: string;
  note: string | null;
  isQualified: boolean;
  qualifyNote: string | null;
  attachment: {
    id: string;
    kind: AttachmentKind;
    code: string | null;
    filename: string;
    size: number;
  };
};

export type RequirementCardProps = {
  projectId: string;
  /** 课题显示名；保留在卡片接口中供调用方统一传递上下文。 */
  projectName: string;
  /** 课题的纵向 / 横向。编辑要求项时决定能不能选「到账经费」 */
  fundingType: FundingType;
  requirement: {
    id: string;
    rawText: string;
    allowedTypes: AchievementType[];
    requiredCount: number;
    constraints: unknown;
    dueDate: Date | null;
    links: LinkedAchievement[];
    materials: LinkedMaterial[];
  };
  gap: RequirementGap;
  /** 在本课题内被多条要求项同时算作达标的成果 */
  reusedAchievementIds: string[];
  /** achievementId → 该成果在别的课题上已被确认达标的课题列表 */
  crossProjectUses: Map<string, Array<{ id: string; name: string }>>;
  candidates: LinkCandidate[];
  /** 本课题还没关联到这条要求项的课题级材料 */
  materialCandidates: MaterialCandidate[];
};

export function RequirementCard({
  projectId,
  fundingType,
  requirement,
  gap,
  reusedAchievementIds,
  crossProjectUses,
  candidates,
  materialCandidates,
}: RequirementCardProps) {
  const constraints = parseConstraints(requirement.constraints);
  const reused = new Set(reusedAchievementIds);

  return (
    <article className="surface space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {requirement.allowedTypes.length === 0 ? (
            <Chip>不限类型</Chip>
          ) : (
            requirement.allowedTypes.map((type) => (
              <Chip key={type}>{ACHIEVEMENT_TYPE_LABELS[type]}</Chip>
            ))
          )}
          {requirement.dueDate ? <Chip>{formatDate(requirement.dueDate)} 前</Chip> : null}
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="tabular-nums font-medium">
            {gap.qualifiedCount}/{gap.requiredCount}
          </span>
          {gap.gap > 0 ? (
            <span className="text-muted-foreground">还差 {gap.gap} 项</span>
          ) : (
            <span className="text-[var(--h-green-fg)]">已齐备</span>
          )}
          <EditRequirement
            requirementId={requirement.id}
            projectId={projectId}
            fundingType={fundingType}
            defaults={{
              rawText: requirement.rawText,
              allowedTypes: requirement.allowedTypes,
              requiredCount: requirement.requiredCount,
              dueDate: requirement.dueDate,
              constraints: requirement.constraints,
            }}
          />
        </div>
      </header>

      {/* rawText 是真相来源，永远原文照抄地显示（CLAUDE.md 第 2 条） */}
      <blockquote className="border-l-2 pl-3 text-sm leading-relaxed whitespace-pre-wrap text-muted-foreground">
        {requirement.rawText}
      </blockquote>

      <ConstraintChips constraints={constraints} />

      {requirement.links.length === 0 ? (
        <p className="rounded-xl bg-muted/40 p-4 text-center text-xs text-muted-foreground">
          尚未挂接成果
        </p>
      ) : (
        <ul className="space-y-2">
          {requirement.links.map((link) => (
            <LinkedAchievementRow
              key={link.id}
              projectId={projectId}
              link={link}
              requirement={requirement}
              isReused={reused.has(link.achievement.id)}
              otherProjects={crossProjectUses.get(link.achievement.id) ?? []}
            />
          ))}
        </ul>
      )}

      {/* 独立成果只从成果库挂接。纯结题报告走下面的课题材料入口，
          不再为了满足要求而制造一条 Achievement。 */}
      <div className="space-y-2 border-t pt-3">
        <LinkAchievementForm
          requirementId={requirement.id}
          projectId={projectId}
          candidates={candidates}
        />
      </div>

      {/* 材料和成果是两回事：成果决定达不达标，材料只是佐证「这条要求交了什么」。
          分开一块放，免得和上面的挂接混成一堆（规格 6.4 / 7.4） */}
      <div className="space-y-2 border-t pt-3">
        <p className="text-xs font-medium text-muted-foreground">
          课题材料
          {requirement.materials.length > 0 ? (
            <span className="ml-1 tabular-nums">{requirement.materials.length}</span>
          ) : null}
        </p>

        {requirement.materials.length > 0 ? (
          <ul className="space-y-1.5">
            {requirement.materials.map((material) => (
              <li
                key={material.id}
                className="rounded-xl bg-muted/40 px-3 py-2"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm" title={material.attachment.filename}>
                      {material.attachment.filename}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ATTACHMENT_KIND_LABELS[material.attachment.kind]}
                      {material.attachment.code ? ` · ${material.attachment.code}` : ""} ·{" "}
                      {formatFileSize(material.attachment.size)}
                      {material.note ? ` · ${material.note}` : ""}
                    </p>
                  </div>
                  <a
                    href={`/api/attachments/${material.attachment.id}?download=1`}
                    download
                    className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
                  >
                    下载
                  </a>
                  <UnlinkMaterialButton
                    linkId={material.id}
                    projectId={projectId}
                    filename={material.attachment.filename}
                  />
                </div>
                <MaterialQualifyControl
                  linkId={material.id}
                  projectId={projectId}
                  isQualified={material.isQualified}
                  qualifyNote={material.qualifyNote}
                />
              </li>
            ))}
          </ul>
        ) : null}

        <UploadRequirementReportForm
          requirementId={requirement.id}
          projectId={projectId}
        />

        <LinkMaterialForm
          requirementId={requirement.id}
          projectId={projectId}
          candidates={materialCandidates}
        />
      </div>
    </article>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-1 text-muted-foreground">{children}</span>
  );
}

function ConstraintChips({ constraints }: { constraints: ReturnType<typeof parseConstraints> }) {
  const chips: string[] = [];
  if (constraints.authorPosition != null) {
    chips.push(
      constraints.authorPosition === 1 ? "第一作者" : `第 ${constraints.authorPosition} 作者及以前`,
    );
  }
  if (constraints.indexedBy) chips.push(`${constraints.indexedBy} 收录`);
  if (constraints.journalLevel) chips.push(`${constraints.journalLevel}期刊`);
  if (constraints.minWords != null) chips.push(`≥${constraints.minWords} 字`);
  if (constraints.maxWords != null) chips.push(`≤${constraints.maxWords} 字`);
  if (constraints.maxDupRate != null) chips.push(`查重 ≤${constraints.maxDupRate}%`);
  if (constraints.maxAigcRate != null) chips.push(`AIGC ≤${constraints.maxAigcRate}%`);

  const manual: string[] = [];
  if (constraints.checkPlatform) manual.push(`以「${constraints.checkPlatform}」为准`);
  manual.push(...(constraints.extra ?? []));

  if (chips.length === 0 && manual.length === 0) return null;

  return (
    <div className="space-y-2">
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {chips.map((chip) => (
            <Chip key={chip}>{chip}</Chip>
          ))}
        </div>
      ) : null}

      {manual.length > 0 ? (
        <ul className="space-y-1">
          {manual.map((item) => (
            <li key={item} className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LinkedAchievementRow({
  projectId,
  link,
  requirement,
  isReused,
  otherProjects,
}: {
  projectId: string;
  link: LinkedAchievement;
  requirement: RequirementCardProps["requirement"];
  isReused: boolean;
  otherProjects: Array<{ id: string; name: string }>;
}) {
  const { warnings } = checkConstraints({
    requirement: { allowedTypes: requirement.allowedTypes, constraints: requirement.constraints },
    achievement: link.achievement,
  });

  return (
    <li className="rounded-xl bg-muted/40 p-3.5">
      <div className="flex items-start gap-2">
        {link.isQualified ? (
          <CircleCheck
            className="mt-0.5 size-4 shrink-0 text-[var(--h-green-fg)]"
            aria-hidden
          />
        ) : (
          <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <Link
            href={`/achievements/${link.achievement.id}`}
            className="text-sm font-medium underline-offset-4 hover:underline"
          >
            {link.achievement.title}
          </Link>
          <p className="text-xs text-muted-foreground">
            {ACHIEVEMENT_TYPE_LABELS[link.achievement.type]} ·{" "}
            {achievementStatusLabel(link.achievement.status, link.achievement.type)}
          </p>
        </div>

        <UnlinkButton linkId={link.id} projectId={projectId} />
      </div>

      {/* 跨课题重复使用：只陈述事实，不阻止（PRD 2.4） */}
      {otherProjects.length > 0 ? (
        <Warning>
          该成果已用于{otherProjects.map((p) => `《${p.name}》`).join("、")}
          结题，重复使用可能存在风险
        </Warning>
      ) : null}

      {isReused ? (
        <Warning>该成果在本课题内被多条要求项同时算作达标，完成度已按去重计算</Warning>
      ) : null}

      {warnings.map((warning) => (
        <Warning key={warning.key}>{warning.message}</Warning>
      ))}

      <QualifyControl
        linkId={link.id}
        projectId={projectId}
        isQualified={link.isQualified}
        qualifyNote={link.qualifyNote}
      />

      {link.achievement.type === "REPORT" ? (
        <UploadRequirementReportForm
          requirementId={requirement.id}
          projectId={projectId}
          legacyAchievementId={link.achievement.id}
        />
      ) : null}
    </li>
  );
}

/** 黄色软提示。只提示，永不阻止（CLAUDE.md 第 3 条） */
function Warning({ children }: { children: React.ReactNode }) {
  return (
    // 深色不能用 amber-950 当底：亮度 0.28 再压透明度，在近纯黑上是一块脏灰。
    // 和健康度徽标同一套写法——低透明度色玻璃 + 同色 inset-ring
    <p className="mt-2 flex items-start gap-1.5 rounded bg-[var(--h-amber-bg)] px-2 py-1.5 text-xs text-[var(--h-amber-fg)]">
      <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}
