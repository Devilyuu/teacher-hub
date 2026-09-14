import "server-only";
import * as XLSX from "xlsx";

/**
 * 把教务系统导出的课表文件读成二维字符串表，解析交给 lib/timetable.ts。
 *
 * 教务系统给的是 **BIFF 格式的 .xls**（不是改了后缀的 HTML，也不是 xlsx），
 * exceljs 只认 xlsx，所以这一处单独引 SheetJS。装的是 cdn.sheetjs.com 的 0.20.x
 * 正式包——npm 上的 `xlsx` 停在 0.18.5，带着已公开的原型污染漏洞不再更新。
 * 同一个读取器顺带也认 xlsx，用户把文件另存过一次也照样能导。
 */
export function readTimetableGrid(bytes: Uint8Array): string[][] {
  const workbook = XLSX.read(bytes, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet) throw new Error("文件里没有工作表");
  // header: 1 → 每行一个数组；defval 保证空格子是 "" 而不是被跳过，列号才对得上表头
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  return rows.map((row) => row.map((cell) => String(cell ?? "")));
}
