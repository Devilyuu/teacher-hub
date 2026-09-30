/**
 * 粘贴导入：把从 Excel、WPS、Word 或网页里复制来的表格，转成规则包 JSON，
 * 再走规则包那条路（buildPromotionPlan / buildCatalogPlan → lib/rules/apply.ts）。
 * 三种导入一个出口，校验、预览、写库各只有一份。
 *
 * 纯函数，浏览器和服务端都用：浏览器里用它即时画出「每一列是什么」的选择界面，
 * 服务端确认时再按同样的参数重算一遍，不信浏览器传上来的结果。
 *
 * 给别的学校用的，所以**一样都不假设**：
 * - 列的含义由人指定（`guessColumnRoles` 只给个初值）；多出来的列可以并进赋分原文，
 *   带上表头，一个字不丢
 * - 合并单元格：复制出来是「第一格有值、下面几格空」，一级指标往下沿用；
 *   二级指标空着、却有规则文字的行，当成上一条的续行接上去
 * - 编号没有、有空、有重复，就按顺序编 1.1、1.2……，预览里写明
 * - 上限只认「10」「10分」「上限10分」这种一眼无歧义的写法，别的照原文留在规则里，
 *   不从「每项2分，累计不超过10分」里猜（第 8 条铁律的同一条：宁可空着也不给看起来精确的错数）
 * - **赋分原文一律不解析**（第 1 条：只计算不判定），分数照旧人工填
 */
import { PERF_PACK_FORMAT } from "@/lib/import/perf-rules";
import { PROMOTION_PACK_FORMAT } from "@/lib/import/promotion-rules";

export type RuleTableKind = "promotion" | "perf";

export const PROMOTION_ROLES = ["ignore", "code", "major", "majorCap", "minor", "rule", "cap", "remark"] as const;
export const PERF_ROLES = [
  "ignore",
  "major",
  "minor",
  "base",
  "national",
  "provincial",
  "city",
  "school",
  "college",
  "rule",
  "remark",
] as const;

export type PromotionRole = (typeof PROMOTION_ROLES)[number];
export type PerfRole = (typeof PERF_ROLES)[number];
export type ColumnRole = PromotionRole | PerfRole;

/** 可以指定给多列的角色：并起来时每段带上表头 */
const MULTI_ROLES = new Set<ColumnRole>(["ignore", "rule", "remark"]);

export function rolesFor(kind: RuleTableKind): readonly ColumnRole[] {
  return kind === "promotion" ? PROMOTION_ROLES : PERF_ROLES;
}

export function roleLabel(kind: RuleTableKind, role: ColumnRole): string {
  switch (role) {
    case "ignore":
      return "不导入";
    case "code":
      return "编号";
    case "major":
      return kind === "promotion" ? "一级指标" : "大类";
    case "majorCap":
      return "一级上限";
    case "minor":
      return kind === "promotion" ? "二级指标" : "小类";
    case "rule":
      return kind === "promotion" ? "赋分原文" : "其他赋分列";
    case "cap":
      return "本栏上限";
    case "remark":
      return "备注";
    case "base":
      return "基本分";
    case "national":
      return "国家级";
    case "provincial":
      return "省级";
    case "city":
      return "市级";
    case "school":
      return "校级";
    case "college":
      return "学院级";
  }
}

/** 一次粘贴的上限。一张规则表几十上百行，两千行已经是十倍余量；再大多半是粘错了东西 */
export const PASTE_LIMITS = { chars: 300_000, rows: 2000, columns: 40 } as const;

// ─── 文本 → 表格 ─────────────────────────────────────────────────────

/**
 * 制表符分隔的文本拆成二维表。Excel / WPS 复制出来就是这个格式：
 * 格子里有换行、制表符或引号时整格用 `"…"` 包起来，里面的引号写成两个。
 *
 * 首尾的空行去掉，每行补齐到一样宽，每格去掉首尾空白（含全角空格和 &nbsp;）。
 */
export function parsePastedTable(text: string): string[][] {
  const source = text.replace(/\r\n?/g, "\n").replace(/　/g, " ");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let atCellStart = true;

  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (atCellStart && char === '"') {
      quoted = true;
      atCellStart = false;
      continue;
    }
    if (char === "\t") {
      row.push(cell);
      cell = "";
      atCellStart = true;
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      atCellStart = true;
      continue;
    }
    cell += char;
    atCellStart = false;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const trimmed = rows.map((cells) => cells.map((value) => value.trim()));
  const isBlank = (cells: string[]) => cells.every((value) => value === "");
  while (trimmed.length > 0 && isBlank(trimmed[trimmed.length - 1]!)) trimmed.pop();
  while (trimmed.length > 0 && isBlank(trimmed[0]!)) trimmed.shift();

  const width = trimmed.reduce((max, cells) => Math.max(max, cells.length), 0);
  return trimmed.map((cells) => [...cells, ...Array<string>(width - cells.length).fill("")]);
}

/** 二维表写回制表符文本（剪贴板里的 HTML 表格转过来时用），引号规则同 Excel */
export function gridToTsv(grid: string[][]): string {
  return grid
    .map((cells) =>
      cells
        .map((value) => (/[\t\n"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
        .join("\t"),
    )
    .join("\n");
}

// ─── 猜每一列是什么 ─────────────────────────────────────────────────

type HeaderRule = { role: ColumnRole; pattern: RegExp };

/** 顺序就是优先级：「一级指标上限」要先认成上限，不能被「一级」抢走 */
const PROMOTION_HEADER_RULES: HeaderRule[] = [
  { role: "majorCap", pattern: /一级.*(上限|满分|封顶|分值)|(上限|满分).*一级/ },
  { role: "code", pattern: /编号|序号|代码|指标号|代号/ },
  { role: "cap", pattern: /上限|封顶|最高分|满分|最高|限分/ },
  { role: "remark", pattern: /备注|说明|附注|认定|依据|要求|材料/ },
  { role: "major", pattern: /一级|大类|类别|类目|考核项目|项目类别|维度/ },
  { role: "minor", pattern: /二级|小类|指标名称|指标|考核内容|项目名称|内容|名称|项目/ },
  { role: "rule", pattern: /赋分|计分|评分|分值|标准|细则|办法|规则|得分|积分|分数/ },
];

const PERF_HEADER_RULES: HeaderRule[] = [
  { role: "base", pattern: /基本分|基础分/ },
  { role: "national", pattern: /国家/ },
  { role: "provincial", pattern: /省/ },
  { role: "college", pattern: /学院级|院级|系部|二级学院/ },
  { role: "school", pattern: /校级|学校|全校/ },
  { role: "city", pattern: /市|地市|区级|县级|局级|厅级/ },
  { role: "ignore", pattern: /^(序号|编号)$/ },
  { role: "remark", pattern: /备注|说明|附注|认定|依据|要求|材料/ },
  { role: "major", pattern: /大类|类别|一级|类目|维度/ },
  { role: "minor", pattern: /小类|二级|项目|内容|名称|指标/ },
  { role: "rule", pattern: /赋分|计分|分值|标准|积分|得分|细则|规则|分数/ },
];

function headerRole(kind: RuleTableKind, text: string): ColumnRole | null {
  const compact = text.replace(/\s+/g, "");
  if (compact === "") return null;
  const rules = kind === "promotion" ? PROMOTION_HEADER_RULES : PERF_HEADER_RULES;
  return rules.find((rule) => rule.pattern.test(compact))?.role ?? null;
}

/** 第一行像不像表头：至少两格认得出是列名（只有两三列的小表认出一格就算） */
export function looksLikeHeader(kind: RuleTableKind, firstRow: string[]): boolean {
  const recognized = firstRow.filter((cell) => headerRole(kind, cell) != null).length;
  const filled = firstRow.filter((cell) => cell !== "").length;
  return recognized >= 2 || (filled <= 3 && recognized >= 1);
}

const CODE_LIKE = /^[（(]?[\d一二三四五六七八九十]{1,3}[）)]?(?:[.．、\-－][\d一二三四五六七八九十]{1,3})*[.．、]?$/;

function ratio(values: string[], test: (value: string) => boolean): number {
  const filled = values.filter((value) => value !== "");
  return filled.length === 0 ? 0 : filled.filter(test).length / filled.length;
}

/**
 * 给每一列一个初始角色，人在界面上再改。
 *
 * 有表头按列名认；没表头按内容认：像编号的（1.1、（三）、二、）当编号，
 * 几乎全是数字的当上限，剩下的文字列依次当一级、二级、赋分原文。
 * 同一个只能有一列的角色被猜给了两列时，后面那列退成「赋分原文」或「不导入」。
 */
export function guessColumnRoles(
  kind: RuleTableKind,
  grid: string[][],
  hasHeader: boolean,
): ColumnRole[] {
  const width = grid[0]?.length ?? 0;
  const columns = Array.from({ length: width }, (_, col) =>
    grid.slice(hasHeader ? 1 : 0, 80).map((row) => row[col] ?? ""),
  );

  let roles: Array<ColumnRole | null>;
  if (hasHeader) {
    roles = (grid[0] ?? []).map((cell) => headerRole(kind, cell));
  } else {
    // 编号只认第一列：「10」「8」这种既像序号又像上限，放在后面几列的几乎都是分值
    roles = columns.map((values, col) => {
      if (col === 0 && ratio(values, (value) => CODE_LIKE.test(value)) >= 0.6) {
        return kind === "promotion" ? "code" : "ignore";
      }
      if (ratio(values, (value) => parseCapText(value) != null) >= 0.6) return kind === "promotion" ? "cap" : "rule";
      return null;
    });
    const textColumns = roles.flatMap((role, col) => (role == null && columns[col]!.some(Boolean) ? [col] : []));
    if (textColumns.length === 1) roles[textColumns[0]!] = "minor";
    else if (textColumns.length > 1) {
      roles[textColumns[0]!] = "major";
      roles[textColumns[1]!] = "minor";
      for (const col of textColumns.slice(2)) roles[col] = "rule";
    }
  }

  // 认不出的列：有字就并进赋分原文（带表头，不丢），整列空的不导入
  const resolved: ColumnRole[] = roles.map((role, col) =>
    role ?? (columns[col]!.some(Boolean) ? "rule" : "ignore"),
  );

  const taken = new Set<ColumnRole>();
  const deduped = resolved.map((role) => {
    if (MULTI_ROLES.has(role)) return role;
    if (taken.has(role)) {
      // 多出来的级别列、上限列当赋分原文留着；多出来的名字列、编号列不导入
      return role === "major" || role === "minor" || role === "code" ? "ignore" : "rule";
    }
    taken.add(role);
    return role;
  });

  // 没有二级指标就没法导：挑第一列还空着的文字列顶上
  if (!deduped.includes("minor")) {
    const candidate = deduped.findIndex(
      (role, col) => (role === "rule" || role === "ignore") && columns[col]!.some(Boolean),
    );
    if (candidate >= 0) deduped[candidate] = "minor";
  }
  return deduped;
}

/** 列的角色合不合法：只能一列的有没有重复、二级指标有没有指定。合法返回 null */
export function validateRoles(kind: RuleTableKind, roles: readonly string[], width: number): string | null {
  const allowed = new Set<string>(rolesFor(kind));
  if (roles.length !== width) return "列数和上面的表对不上，重新粘贴一次";
  const unknown = roles.find((role) => !allowed.has(role));
  if (unknown) return `不认识的列类型「${unknown}」`;
  if (!roles.includes("minor")) return `要指定哪一列是「${roleLabel(kind, "minor")}」`;
  for (const role of new Set(roles)) {
    if (MULTI_ROLES.has(role as ColumnRole)) continue;
    if (roles.filter((value) => value === role).length > 1) {
      return `「${roleLabel(kind, role as ColumnRole)}」只能指定一列`;
    }
  }
  return null;
}

// ─── 单元格 ─────────────────────────────────────────────────────────

const FULL_WIDTH_DIGIT = /[０-９．]/g;

function toHalfWidth(text: string): string {
  return text.replace(FULL_WIDTH_DIGIT, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

/**
 * 上限格子 → 数字。只认一眼无歧义的写法：「10」「10分」「上限10分」「不超过10分」「10分封顶」。
 * 格子里有两个数（「每项2分，上限10分」）或者别的字，一律不认，返回 null——
 * 原文还在规则里，人一看就知道，比猜错一个数好。
 */
export function parseCapText(text: string): number | null {
  const compact = toHalfWidth(text).replace(/\s+/g, "");
  const match = /^(?:上限|最高|最多|封顶|不超过|不高于|≤|<=)?(\d{1,4}(?:\.\d{1,2})?)分?(?:封顶|为限|以内)?$/.exec(
    compact,
  );
  return match ? Number(match[1]) : null;
}

/**
 * 名字里的换行（Excel 里 Alt+Enter 折的行）去掉：汉字之间直接接上，
 * 其余换成一个空格。规则原文和备注不走这里，换行照原样留着
 */
export function cleanName(text: string): string {
  return text
    .replace(/([　-鿿＀-￯])\s*\n\s*(?=[　-鿿＀-￯])/g, "$1")
    .replace(/\s*\n\s*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

/** 这几行不是指标，是表格的汇总行 */
const SUMMARY_ROW = /^(合计|总计|小计|总分|共计)[:：]?$/;

/** 「一、教学工作」「（三）科研」这种写在指标名那一列里的分节标题 */
const SECTION_TITLE = /^[（(]?[一二三四五六七八九十]{1,3}[）)]?[、.．]/;

/** 纯数字（小计、分值）不能当一级指标的名字 */
const NUMERIC_ONLY = /^[\d.．\s分]+$/;

// ─── 表格 → 规则包 ───────────────────────────────────────────────────

export type PasteOptions = {
  hasHeader: boolean;
  year: number;
  source: string;
};

export type PasteResult<Doc> = {
  doc: Doc;
  /** 系统替人做了什么（编了编号、并了续行），预览里照实写出来 */
  notes: string[];
  /** 读的时候有疑问的地方（上限没认出来、找不到归属），不挡导入 */
  warnings: string[];
  /** 认出来的指标条数 */
  itemCount: number;
};

type Item = {
  /** 在粘贴的表里是第几行（从 1 数，含表头），提示里用 */
  line: number;
  major: string;
  majorCap: number | null;
  minor: string;
  code: string;
  cap: number | null;
  /** 角色 → 各段文字。续行接在后面，最后用换行拼 */
  texts: Map<ColumnRole, string[]>;
};

type Walked = { items: Item[]; notes: string[]; warnings: string[] };

/**
 * 逐行走一遍，认出每一条指标。两张表共用：列的角色不同，行的结构是一样的。
 *
 * 一行是什么：
 * - 二级指标格有字 → 一条新指标；和上一条同属一个一级、名字也一样 → 合并单元格拆出来的续行
 * - 二级指标格空着、却有规则或备注 → 上一条的续行
 * - 二级指标格空着、只有一级指标（或别处一格字）→ 一级指标的标题行，后面的行归它
 */
function walkRows(
  kind: RuleTableKind,
  grid: string[][],
  roles: readonly ColumnRole[],
  hasHeader: boolean,
): Walked {
  const header = hasHeader ? (grid[0] ?? []) : [];
  const rows = hasHeader ? grid.slice(1) : grid;
  const firstLine = hasHeader ? 2 : 1;
  const colOf = (role: ColumnRole) => roles.indexOf(role);
  const colsOf = (role: ColumnRole) => roles.flatMap((value, col) => (value === role ? [col] : []));

  const minorCol = colOf("minor");
  const majorCol = colOf("major");
  const codeCol = colOf("code");
  const capCol = colOf("cap");
  const majorCapCol = colOf("majorCap");
  const textRoles: ColumnRole[] =
    kind === "promotion"
      ? ["rule", "remark"]
      : ["base", "national", "provincial", "city", "school", "college", "rule", "remark"];

  const notes: string[] = [];
  const warnings: string[] = [];
  const items: Item[] = [];
  let currentMajor = "";
  let currentMajorCap: number | null = null;
  let continuationCount = 0;
  const orphanLines: number[] = [];
  const summaryLines: number[] = [];
  const majorTextLines: number[] = [];
  const majorLabel = kind === "promotion" ? "一级指标" : "大类";
  const minorLabel = kind === "promotion" ? "二级指标" : "小类";

  /** 一个角色在这一行的文字。同一角色多列时每段带上表头，一个字不丢 */
  const textOf = (row: string[], role: ColumnRole): string => {
    const cols = colsOf(role);
    const parts = cols.flatMap((col) => {
      const value = row[col] ?? "";
      if (value === "") return [];
      const label = header[col]?.replace(/\s+/g, "") ?? "";
      return [cols.length > 1 && label ? `${label} ${value}` : value];
    });
    return parts.join("；");
  };

  const readCap = (row: string[], col: number, line: number, what: string): number | null => {
    if (col < 0) return null;
    const raw = row[col] ?? "";
    if (raw === "") return null;
    const value = parseCapText(raw);
    if (value == null) warnings.push(`第 ${line} 行的${what}「${raw}」不是一个单独的数，先按没有上限处理`);
    return value;
  };

  const append = (item: Item, row: string[]) => {
    for (const role of textRoles) {
      const text = textOf(row, role);
      if (text) item.texts.set(role, [...(item.texts.get(role) ?? []), text]);
    }
  };

  rows.forEach((row, index) => {
    const line = firstLine + index;
    if (row.every((cell) => cell === "")) return;

    const minor = minorCol >= 0 ? cleanName(row[minorCol] ?? "") : "";
    const major = majorCol >= 0 ? cleanName(row[majorCol] ?? "") : "";
    if (major && major !== currentMajor) {
      currentMajor = major;
      currentMajorCap = null;
    }
    const majorCap = readCap(row, majorCapCol, line, "一级上限");
    if (majorCap != null) currentMajorCap = majorCap;

    if (SUMMARY_ROW.test(minor.replace(/\s+/g, "")) || (!minor && SUMMARY_ROW.test(major.replace(/\s+/g, "")))) {
      summaryLines.push(line);
      return;
    }

    const hasText = textRoles.some((role) => textOf(row, role) !== "");
    const previous = items[items.length - 1];

    if (!minor) {
      if (hasText) {
        if (!previous) {
          orphanLines.push(line);
        } else if (!major || previous.major === currentMajor) {
          // 合并单元格拆出来的续行：接到上一条后面
          append(previous, row);
          if (previous.cap == null) previous.cap = readCap(row, capCol, line, "上限");
          continuationCount += 1;
        } else {
          // 换了一个一级指标、却没有二级指标名：那是一级指标自己的说明，没地方放
          majorTextLines.push(line);
        }
        return;
      }
      if (major) return; // 一级指标自己占一行
      // 只有零星几格字（整行合并的标题、写在编号列里的「一、教学工作」）：挑最长的那格当一级指标
      const title = row
        .filter((_, col) => col !== capCol && col !== majorCapCol)
        .map(cleanName)
        .filter((value) => value !== "" && !NUMERIC_ONLY.test(value))
        .sort((a, b) => b.length - a.length)[0];
      if (title) {
        currentMajor = title;
        currentMajorCap = null;
      }
      return;
    }

    // 一级、二级写在同一列里（没指定一级指标列时）：「一、教学工作」这种没有规则的行是分节标题
    if (majorCol < 0 && !hasText && SECTION_TITLE.test(minor) && (capCol < 0 || !row[capCol])) {
      currentMajor = minor;
      currentMajorCap = null;
      return;
    }

    if (previous && previous.minor === minor && previous.major === (currentMajor || previous.major)) {
      append(previous, row);
      if (previous.cap == null) previous.cap = readCap(row, capCol, line, "上限");
      continuationCount += 1;
      return;
    }

    const item: Item = {
      line,
      major: currentMajor,
      majorCap: currentMajorCap,
      minor,
      code: codeCol >= 0 ? cleanName(row[codeCol] ?? "") : "",
      cap: readCap(row, capCol, line, "上限"),
      texts: new Map(),
    };
    append(item, row);
    items.push(item);
  });

  if (continuationCount > 0) {
    notes.push(`有 ${continuationCount} 行是上一条的续行（合并单元格拆出来的），已经接到上一条的规则里`);
  }
  if (summaryLines.length > 0) {
    notes.push(`第 ${summaryLines.join("、")} 行是合计行，没有导入`);
  }
  if (orphanLines.length > 0) {
    warnings.push(`第 ${orphanLines.join("、")} 行有规则文字，但前面没有指标可以接上，没有导入`);
  }
  if (majorTextLines.length > 0) {
    warnings.push(
      `第 ${majorTextLines.join("、")} 行只有${majorLabel}和文字、没有${minorLabel}名，没有导入` +
        (kind === "promotion" ? "（一级指标自己的说明可以导入后写进整表说明）" : ""),
    );
  }
  const ungrouped = items.filter((item) => !item.major);
  if (ungrouped.length > 0) {
    warnings.push(`有 ${ungrouped.length} 条看不出属于哪个${majorLabel}，先放进「未分组」，导入后可以在分类表里改`);
    for (const item of ungrouped) item.major = "未分组";
  }
  return { items, notes, warnings };
}

const joined = (item: Item, role: ColumnRole): string | undefined => {
  const parts = item.texts.get(role);
  return parts && parts.length > 0 ? parts.join("\n") : undefined;
};

/**
 * 编号：原表每条都有、互不重复、不超过 20 个字，就照原样用；
 * 否则整张表按顺序编成「一级序号.二级序号」，并写进 notes 说清楚为什么
 */
function assignCodes(items: Item[], codeColumnMapped: boolean): { codes: string[]; note: string | null } {
  const raw = items.map((item) => item.code);
  const seen = new Set<string>();
  const duplicates = raw.filter((code) => code !== "" && (seen.has(code) || !seen.add(code)));
  const missing = raw.filter((code) => code === "").length;
  const tooLong = raw.filter((code) => code.length > 20).length;
  if (codeColumnMapped && missing === 0 && duplicates.length === 0 && tooLong === 0) {
    return { codes: raw, note: null };
  }

  const majorOrder: string[] = [];
  const minorCount = new Map<string, number>();
  const codes = items.map((item) => {
    if (!majorOrder.includes(item.major)) majorOrder.push(item.major);
    const count = (minorCount.get(item.major) ?? 0) + 1;
    minorCount.set(item.major, count);
    return `${majorOrder.indexOf(item.major) + 1}.${count}`;
  });

  let reason = "原表没有编号列";
  if (codeColumnMapped) {
    const problems = [
      missing > 0 ? `${missing} 行是空的` : null,
      duplicates.length > 0 ? `有重复（${[...new Set(duplicates)].slice(0, 3).join("、")}）` : null,
      tooLong > 0 ? `${tooLong} 行超过 20 个字` : null,
    ].filter(Boolean);
    reason = `编号那一列${problems.join("、")}`;
  }
  return { codes, note: `${reason}，按顺序编成了 1.1、1.2……（只在本系统和导出的表里用，导入后可以改）` };
}

export function tableToPromotionPack(
  grid: string[][],
  roles: readonly ColumnRole[],
  options: PasteOptions,
): PasteResult<{
  format: string;
  year: number;
  source: string;
  indicators: Array<Record<string, unknown>>;
}> {
  const { items, notes, warnings } = walkRows("promotion", grid, roles, options.hasHeader);
  const { codes, note } = assignCodes(items, roles.includes("code"));
  if (note) notes.unshift(note);

  const byName = new Map<string, number[]>();
  for (const item of items) {
    const key = `${item.major}\u0001${item.minor}`;
    byName.set(key, [...(byName.get(key) ?? []), item.line]);
  }
  for (const [key, lines] of byName) {
    if (lines.length > 1) {
      const [major, minor] = key.split("\u0001");
      warnings.push(`「${major} / ${minor}」出现了 ${lines.length} 次（第 ${lines.join("、")} 行），会导成几条编号不同的指标`);
    }
  }

  return {
    doc: {
      format: PROMOTION_PACK_FORMAT,
      year: options.year,
      source: options.source,
      indicators: items.map((item, index) => ({
        code: codes[index],
        major_indicator: item.major,
        major_cap: item.majorCap,
        minor_indicator: item.minor,
        scoring_rule: joined(item, "rule") ?? null,
        remark: joined(item, "remark") ?? null,
        cap: item.cap,
      })),
    },
    notes,
    warnings,
    itemCount: items.length,
  };
}

export function tableToPerfPack(
  grid: string[][],
  roles: readonly ColumnRole[],
  options: PasteOptions,
): PasteResult<{ format: string; year: number; source: string; rules: Array<Record<string, unknown>> }> {
  const { items, notes, warnings } = walkRows("perf", grid, roles, options.hasHeader);
  return {
    doc: {
      format: PERF_PACK_FORMAT,
      year: options.year,
      source: options.source,
      rules: items.map((item, index) => {
        // 「基本分」那一列和并进来的其他赋分列放在同一格：界面上它们显示在最前面
        const base = [joined(item, "base"), joined(item, "rule")].filter(Boolean).join("；");
        return {
          category: item.major,
          subcategory: item.minor,
          base_rule: base || null,
          national_rule: joined(item, "national") ?? null,
          provincial_rule: joined(item, "provincial") ?? null,
          city_rule: joined(item, "city") ?? null,
          school_rule: joined(item, "school") ?? null,
          college_rule: joined(item, "college") ?? null,
          remark: joined(item, "remark") ?? null,
          sort_order: (index + 1) * 10,
        };
      }),
    },
    notes,
    warnings,
    itemCount: items.length,
  };
}
