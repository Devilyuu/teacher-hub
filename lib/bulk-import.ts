/**
 * 粘贴导入的同名去重。班主任名册和导师名单共用一份。
 *
 * **两头都要去重，缺一不可**：
 * - 对着**库里已有的**姓名去重，是因为双选名单整表重复粘贴是常态，
 *   已在名单里的不该拦住新增的那几个；
 * - 对着**这一块里已出现过的**姓名去重，是因为一次贴进一张自带重复的表
 *   同样会建出两条同名——两张表都没有 `(parentId, name)` 唯一约束拦得住。
 *
 * 只去重不报错：校验永远不阻止保存（CLAUDE.md 第 3 条），
 * 跳过了几个由调用方在回执里说一句。
 *
 * 抽成一份是因为两个模块各写一遍时，班主任那份只做了前一半，
 * 而「整表重复粘贴是安全的」这句承诺写在 CLAUDE.md 里、对两边都成立才算数。
 */
export function dedupeRowsByName<T extends { name: string }>(
  rows: readonly T[],
  existingNames: Iterable<string>,
): T[] {
  const seen = new Set(existingNames);
  const fresh: T[] = [];
  for (const row of rows) {
    if (seen.has(row.name)) continue;
    seen.add(row.name);
    fresh.push(row);
  }
  return fresh;
}
