/**
 * 「课题能挂哪几项」的候选口径，职称表和绩效表共用。
 *
 * 由人在分类表里给某几项勾「课题可挂」（`projectEligible`）。原来是代码里写死的两份名单
 * （职称 5.2 / 5.3、绩效四个小类名），换一所学校编号和名字一个都对不上（2026-09-27）。
 *
 * **当年一项都没勾时候选是全部。** 刚导进来的表谁也没勾过，这时把课题表单里的下拉清空
 * 等于不让用——校验永远不阻止保存（CLAUDE.md 第 3 条）。勾了才收窄。
 *
 * 只做过滤，不按纵横向、级别替人挑（第 11 条：不写映射函数）。
 */
export function projectEligibleOf<T extends { projectEligible: boolean }>(rows: readonly T[]): T[] {
  const flagged = rows.filter((row) => row.projectEligible);
  return flagged.length > 0 ? flagged : [...rows];
}

/** 这张表有没有人勾过「课题可挂」。界面据此决定要不要提示「勾了可以只显示相关的几项」 */
export function hasProjectEligible(rows: ReadonlyArray<{ projectEligible: boolean }>): boolean {
  return rows.some((row) => row.projectEligible);
}
