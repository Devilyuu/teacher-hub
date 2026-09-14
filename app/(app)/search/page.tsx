import type { Metadata } from "next";
import { Search } from "lucide-react";
import { MagnifierArt } from "@/components/empty-art";
import { Input } from "@/components/ui/input";
import { getEnabledModules } from "@/lib/module-settings";
import { search } from "@/lib/queries/search";
import {
  SEARCH_COPY,
  SEARCH_GROUPS,
  SearchResultTarget,
} from "@/lib/search-result-target";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "搜索" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const results = await search(query, await getEnabledModules());
  const total = results.hits.length;

  return (
    <div className="space-y-6">
      <header className="space-y-2 pt-2">
        <h1 className="page-title">搜索</h1>
        <p className="measure text-muted-foreground">
          {SEARCH_COPY.description}
        </p>
      </header>

      {/* 原生 form + GET：搜索结果要能被收藏、能后退，所以走 URL 而不是客户端状态 */}
      <form action="/search" className="flex gap-2">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            name="q"
            defaultValue={query}
            placeholder={SEARCH_COPY.placeholder}
            className="pl-9"
            autoFocus
          />
        </div>
      </form>

      {query === "" ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-14 text-center">
          <MagnifierArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            {SEARCH_COPY.emptyHint}
          </p>
        </div>
      ) : total === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-3xl bg-well p-14 text-center">
          <MagnifierArt className="size-12 text-muted-foreground/60" />
          <p className="text-sm text-muted-foreground">
            没有找到「{query}」相关的内容。
          </p>
        </div>
      ) : (
        <>
          <p className="px-1 text-sm text-muted-foreground">
            找到{" "}
            <span className="font-medium tabular-nums text-foreground">
              {total}
            </span>{" "}
            条
            {SEARCH_GROUPS.filter(
              (group) => results.counts[group.kind] > 0,
            ).map((group) => (
              <span key={group.kind}>
                {" · "}
                {group.label}{" "}
                <span className="tabular-nums">
                  {results.counts[group.kind]}
                </span>
              </span>
            ))}
          </p>

          <div className="space-y-6">
            {SEARCH_GROUPS.map((group) => {
              const hits = results.hits.filter(
                (hit) => hit.kind === group.kind,
              );
              if (hits.length === 0) return null;

              return (
                <section key={group.kind} className="space-y-2">
                  <h2 className="flex items-center gap-2 px-1 text-sm font-medium text-muted-foreground">
                    {group.label}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                      {hits.length}
                    </span>
                  </h2>

                  {/* 整组一张卡、行间只有分隔线（CLAUDE.md：一条记录不是一张卡片）。
                      原来 22 条结果就是 22 张各自浮起的大白卡 */}
                  <ul className="surface divide-y divide-border/50 overflow-hidden py-1">
                    {hits.map((hit) => (
                      <li key={`${hit.kind}-${hit.id}`}>
                        <SearchResultTarget hit={hit} />
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
