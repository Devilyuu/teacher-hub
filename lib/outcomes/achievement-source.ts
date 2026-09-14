import { entryTitle } from "@/lib/competitions";
import type { Level } from "@/lib/generated/prisma/enums";

/**
 * 一条成果是从哪儿「引用」过来的。
 *
 * 台账里绝大多数成果是直接建的，没有来源。有来源的只有两类，
 * 而它们走的是**同一个模式**：外部/过程记录留在自己那张表里，
 * 用户人工点「引用为成果」才建 Achievement，系统绝不自动创建（第 1 条铁律）。
 *
 * - 教案回流（`TeachingImport`，增量 3.6）
 * - 指导参赛（`CompetitionEntry`，2026-09-12）
 *
 * 补这个反链是因为指针一直是**单向**的：来源那边能跳到成果，成果这边跳不回去。
 * 于是台账里冒出一条「指导学生获省一等奖」，想核对是哪次比赛、谁参的赛、
 * 证书在不在，只能回参赛页一条条翻。
 *
 * 放在 lib/outcomes 下而不是各自模块里：**两类来源渲染成同一行**，
 * 分两处写早晚长成两个样子。
 */
export type AchievementSource = {
  /** React key，也是「哪张表的哪一行」 */
  key: string;
  kind: "competition" | "teaching";
  /** 来源类型的中文名，行首那个标签 */
  kindLabel: string;
  /** 这条来源本身怎么称呼 */
  label: string;
  href: string;
  /** 补充信息（课程、学期…）。没有就不渲染，别留个空括号 */
  hint: string | null;
};

export type CompetitionSourceRow = {
  id: string;
  year: number;
  track: string | null;
  level: Level;
  competition: { name: string };
};

export type TeachingSourceRow = {
  id: string;
  title: string;
  courseName: string | null;
  term: string | null;
};

/**
 * 汇总来源。**参赛在前**：它带日期、带队员、带证书，是核对时更想先看的那个；
 * 教案回流只是一份 DOCX。
 *
 * 返回数组而不是单个值：库里这两个都是反向一对多关系。实际上一条成果
 * 最多只有一个来源（引用动作会挡住重复引用），但**按类型硬当成单值就是在
 * 替数据库做它没做的保证**——真出现两条时，界面该把两条都显示出来，
 * 而不是静悄悄只画第一条。
 */
export function achievementSources(row: {
  competitionEntries?: CompetitionSourceRow[];
  teachingImports?: TeachingSourceRow[];
}): AchievementSource[] {
  const sources: AchievementSource[] = [];

  for (const entry of row.competitionEntries ?? []) {
    sources.push({
      key: `competition:${entry.id}`,
      kind: "competition",
      kindLabel: "指导参赛",
      label: entryTitle({
        year: entry.year,
        competitionName: entry.competition.name,
        track: entry.track,
        level: entry.level,
      }),
      href: `/competitions/${entry.id}`,
      hint: null,
    });
  }

  for (const item of row.teachingImports ?? []) {
    sources.push({
      key: `teaching:${item.id}`,
      kind: "teaching",
      kindLabel: "教案回流",
      label: item.title,
      // 回流记录没有自己的详情页，教学枢纽那一列就是它的家
      href: "/teaching",
      hint: [item.courseName, item.term].filter(Boolean).join(" · ") || null,
    });
  }

  return sources;
}
