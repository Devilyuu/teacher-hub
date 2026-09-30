/**
 * 剪贴板里的 HTML 表格 → 二维表。
 *
 * 从 Excel、WPS、Word 复制表格时，剪贴板里除了纯文本还有一份 HTML，
 * **合并单元格的结构只在 HTML 里有**（rowspan / colspan）。纯文本里 Word 的表格
 * 一个格子里有两段话就会被拆成两行，合并单元格也只剩第一格有字。
 * 所以粘贴时先看有没有 HTML 表格，有就按它展开，再转成制表符文本放进输入框——
 * 后面的解析只认制表符文本这一种格式（lib/import/pasted-table.ts）。
 *
 * 展开规则：
 * - **竖着合并的格子（rowspan）往下每一行都填上**：一级指标、二级指标竖着合并，
 *   意思就是「这几行都属于它」
 * - **横着合并的（colspan）只放在第一格**：整行合并的多半是分节标题
 *   （「一、教学工作」），铺满每一列就成了一条以标题为名的假指标
 */

export type HtmlCell = { text: string; rowSpan: number; colSpan: number };

/** 纯函数，单测锁着。`htmlTableToGrid` 从 DOM 里读出格子后交给它 */
export function expandMergedCells(rows: HtmlCell[][]): string[][] {
  const grid: string[][] = rows.map(() => []);
  const occupied: boolean[][] = rows.map(() => []);

  rows.forEach((cells, rowIndex) => {
    let col = 0;
    for (const cell of cells) {
      while (occupied[rowIndex]![col]) col += 1;
      const rowSpan = Math.max(1, Math.min(cell.rowSpan || 1, rows.length - rowIndex));
      const colSpan = Math.max(1, Math.min(cell.colSpan || 1, 100));
      for (let dr = 0; dr < rowSpan; dr++) {
        for (let dc = 0; dc < colSpan; dc++) {
          occupied[rowIndex + dr]![col + dc] = true;
          grid[rowIndex + dr]![col + dc] = dc === 0 ? cell.text : "";
        }
      }
      col += colSpan;
    }
  });

  const width = grid.reduce((max, row) => Math.max(max, row.length), 0);
  return grid.map((row) => Array.from({ length: width }, (_, col) => row[col] ?? ""));
}

/** 格子里的文字：换行（<br>、段落）保留成 \n，其余空白压成一个空格 */
function cellText(cell: Element): string {
  const clone = cell.cloneNode(true) as Element;
  for (const br of Array.from(clone.querySelectorAll("br"))) br.replaceWith("\n");
  for (const block of Array.from(clone.querySelectorAll("p, div, li"))) block.append("\n");
  return (clone.textContent ?? "")
    .split("\n")
    .map((line) => line.replace(/[\s ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * 只在浏览器里调（要 DOMParser）。剪贴板里有好几张表时取行数最多的那张——
 * Word 的表格常常嵌着小表，最外面那张才是要的。没有表格返回 null，照常粘贴纯文本
 */
export function htmlTableToGrid(html: string): string[][] | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tables = Array.from(doc.querySelectorAll("table"));
  const table = tables.sort((a, b) => b.rows.length - a.rows.length)[0];
  if (!table || table.rows.length === 0) return null;
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => ({
      text: cellText(cell),
      rowSpan: cell.rowSpan,
      colSpan: cell.colSpan,
    })),
  );
  return expandMergedCells(rows);
}
