import Link from "next/link";
import { Download } from "lucide-react";
import type { SearchHit } from "@/lib/queries/search";

export const SEARCH_GROUPS: Array<{ kind: SearchHit["kind"]; label: string }> = [
  { kind: "project", label: "课题" },
  { kind: "achievement", label: "成果" },
  { kind: "document", label: "常用文档" },
  { kind: "task", label: "任务" },
  { kind: "meeting", label: "会议" },
  { kind: "duty", label: "轮派" },
  // 指导参赛（关闭时查询不会执行，这一组自然为空）
  { kind: "competition", label: "参赛" },
  // 班主任模块（关闭时查询不会执行，这两组自然为空）
  { kind: "student", label: "学生" },
  { kind: "honor", label: "学生荣誉" },
];

export const SEARCH_COPY = {
  description:
    "跨课题、成果、常用文档、任务、会议、轮派、参赛一起找——合并之后，最常见的情况是「记得有这件事，不记得它在哪个模块」。常用文档搜索文件名与备注，结果可直接下载。",
  placeholder: "课题名称、成果题目、文件名或备注、任务、会议纪要…",
  emptyHint: "输入关键词开始搜索。会议纪要正文、常用文档的文件名与备注均在搜索范围内。",
};

function SearchResultContent({ hit, downloadable = false }: { hit: SearchHit; downloadable?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      {downloadable ? (
        <Download className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      ) : null}
      <div className="min-w-0 break-words">
        <p className="text-sm">{hit.title}</p>
        {hit.meta || downloadable ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {hit.meta}
            {/* 分隔点只在两边都有内容时出现，否则行尾挂一个孤立的「·」 */}
            {hit.meta && downloadable ? " · " : null}
            {downloadable ? "下载" : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function SearchResultTarget({ hit }: { hit: SearchHit }) {
  // 行不是卡：整组共用一张 .surface（search/page.tsx），行内只做 hover 提亮。
  // focus 环用 inset 画在行内侧，否则会被相邻行和卡片的 overflow-hidden 裁掉
  const className =
    "block px-4 py-3 transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50";

  if (hit.kind === "document") {
    return (
      <a href={hit.href} download className={className}>
        <SearchResultContent hit={hit} downloadable />
      </a>
    );
  }

  return (
    <Link href={hit.href} className={className}>
      <SearchResultContent hit={hit} />
    </Link>
  );
}
