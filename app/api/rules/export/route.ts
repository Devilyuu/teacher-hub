import { prisma } from "@/lib/db";
import { perfPackOf, promotionPackOf, rulePackFileName } from "@/lib/rules/pack";
import { sessionGuard } from "@/lib/server-auth";

export const dynamic = "force-dynamic";

/**
 * 下载某一年度的职称表 / 绩效表规则包（JSON）：`/api/rules/export?table=promotion&year=2026`。
 *
 * 给同校同事直接导入用，格式就是导入格式（lib/rules/pack.ts）。里面只有学校的规则，
 * 没有任何人的成果；但它还是只给登录的人——规则表常常是学校内部文件。
 * 文件名只进 Content-Disposition，不进 URL。
 */
export async function GET(request: Request) {
  const denied = await sessionGuard();
  if (denied) return denied;

  const url = new URL(request.url);
  const table = url.searchParams.get("table");
  const year = Number(url.searchParams.get("year"));
  if ((table !== "promotion" && table !== "perf") || !Number.isInteger(year)) {
    return new Response("参数不对", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }

  let pack: unknown;
  if (table === "promotion") {
    const [ruleset, categories] = await Promise.all([
      prisma.promotionRuleset.findUnique({ where: { year } }),
      prisma.promotionCategory.findMany({ where: { year }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    ]);
    if (!ruleset && categories.length === 0) return notFound(year);
    const num = (value: { toString(): string } | null) => (value == null ? null : Number(value));
    pack = promotionPackOf({
      ruleset: {
        year,
        source: ruleset?.source ?? `职称量化表 ${year} 版`,
        generalNotes: ruleset?.generalNotes ?? [],
        teacherTotal: num(ruleset?.teacherTotal ?? null),
        labTotal: num(ruleset?.labTotal ?? null),
        ideologyTotal: num(ruleset?.ideologyTotal ?? null),
        eduAdminTotal: num(ruleset?.eduAdminTotal ?? null),
      },
      categories: categories.map((row) => ({
        code: row.code,
        majorIndicator: row.majorIndicator,
        majorCap: num(row.majorCap),
        minorIndicator: row.minorIndicator,
        scoringRule: row.scoringRule,
        remark: row.remark,
        cap: num(row.cap),
        capGroup: row.capGroup,
        capNote: row.capNote,
        appliesTo: row.appliesTo,
        projectEligible: row.projectEligible,
        sortOrder: row.sortOrder,
      })),
    });
  } else {
    const categories = await prisma.perfCategory.findMany({
      where: { year },
      orderBy: [{ sortOrder: "asc" }, { minorCategory: "asc" }],
    });
    if (categories.length === 0) return notFound(year);
    pack = perfPackOf({ year, categories });
  }

  const fileName = rulePackFileName(table, year);
  return new Response(`${JSON.stringify(pack, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="rules-${table}-${year}.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Cache-Control": "no-store",
    },
  });
}

function notFound(year: number) {
  return new Response(`${year} 版还没有这张表`, {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
