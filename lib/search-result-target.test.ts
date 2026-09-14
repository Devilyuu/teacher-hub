import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: ReactNode;
    className?: string;
  }) => createElement("a", { href, className, "data-next-link": "true" }, children),
}));

import {
  SEARCH_COPY,
  SEARCH_GROUPS,
  SearchResultTarget,
} from "@/lib/search-result-target";
import type { SearchHit } from "@/lib/queries/search";

const documentHit: SearchHit = {
  kind: "document",
  id: "attachment-id",
  title: "课程标准（2026）.pdf",
  meta: "课程标准",
  href: "/api/attachments/attachment-id?download=1",
};

describe("SearchResultTarget", () => {
  it("renders a personal document as a native download link without changing its href", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultTarget, { hit: documentHit }),
    );

    expect(markup).toContain(
      '<a href="/api/attachments/attachment-id?download=1" download=""',
    );
    expect(markup).toContain("课程标准（2026）.pdf");
    expect(markup).toContain("课程标准");
    expect(markup).toContain("下载");
    // 行不是卡（CLAUDE.md）：整组共用一张 .surface，行内只有 hover 提亮，
    // 不许回退成每行一张 surface-interactive 卡
    expect(markup).not.toContain("surface-interactive");
    expect(markup).toContain("hover:bg-muted/50");
    expect(markup).toContain("focus-visible:ring-3");
    expect(markup).toContain("break-words");
    expect(markup).not.toContain("data-next-link");
  });

  it("keeps non-document hits as ordinary in-app links without a download attribute", () => {
    const markup = renderToStaticMarkup(
      createElement(SearchResultTarget, {
        hit: {
          kind: "project",
          id: "project-id",
          title: "示例课题",
          meta: "进行中",
          href: "/projects/project-id",
        },
      }),
    );

    expect(markup).toContain('href="/projects/project-id"');
    expect(markup).toContain('data-next-link="true"');
    expect(markup).not.toContain("download=");
  });
});

describe("personal-document search presentation", () => {
  it("places 常用文档 after projects and achievements, and avoids claiming category names are searchable", () => {
    expect(SEARCH_GROUPS.map((group) => group.label)).toEqual([
      "课题",
      "成果",
      "常用文档",
      "任务",
      "会议",
      "轮派",
      "参赛",
      "学生",
      "学生荣誉",
    ]);
    expect(SEARCH_COPY.description).toContain("文件名与备注");
    expect(SEARCH_COPY.placeholder).toContain("文件名或备注");
    expect(SEARCH_COPY.emptyHint).toContain("文件名与备注");
    expect(SEARCH_COPY.description).not.toContain("分类名");
    expect(SEARCH_COPY.placeholder).not.toContain("分类名");
    expect(SEARCH_COPY.emptyHint).not.toContain("分类名");
  });
});
