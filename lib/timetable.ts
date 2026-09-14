/**
 * 课表：教务系统导出表的解析，和「本周哪几个半天有课」的推算。
 *
 * 纯函数，不碰数据库、不碰文件——读 .xls 的那一步在 lib/import/timetable-xls.ts，
 * 这里只认一张二维字符串表。首页那张卡、月历、设置页全靠这一份口径，
 * 不许在组件里另写一遍「第几节算上午」。
 *
 * 教务系统（本校用的那套）导出的课表长这样：
 *
 *   行 0    2026-2027学年第1学期 | 林知远老师的课表 | 示例学院 教工号…
 *   行 1    节次 |    | 星期一 | 星期二 | … | 星期日
 *   行 2    上午 | 一 | 课程/(1-2节)10-13周/东校区 实训楼309/林知远/教学班//数字媒体2601;数字媒体2602/ /多媒体
 *   行 3         | 二 | 课程/(3-4节)…
 *   …
 *   末行    注--内容顺序为：课程<>周次<>校区<>地点<>教师<>教学班<>课堂名称<>教学班组成<>…
 *           本学期2026-09-07正式上课至2027-01-17结束，共19周.
 *
 * 一格里可能叠几门课，用换行分开；每门课各字段用「/」分开；
 * 「(1-2节)」写在周次前面，所以**节次取自条目本身，不取自行标签**——
 * 行标签「一二三四」是大节编号，和实际节次差一个映射，而且合并单元格
 * 读出来只有第一行有值。周次可以是「10-13周」「13周,18-19周」「1-16周(单)」。
 *
 * 表头那行的开学日和总周数顺手一起解析：它正是设置页「学期」要的东西，
 * 导入时能直接把学期建好，不用人再去查校历。
 */
import { diffInDays, formatDateOnly } from "@/lib/date";
import { MAX_TEACHING_WEEKS, semesterStatus, type SemesterLike } from "@/lib/semester";

/** 一个学期最长多少毫秒（lib/semester.ts 的量程）。月历用它筛「和这个月有交集的学期」 */
export const MAX_TEACHING_WEEKS_MS = MAX_TEACHING_WEEKS * 7 * 86_400_000;

/** 半天。晚上单列：多数老师没晚课，首页那张卡默认只画两列 */
export type HalfDay = "AM" | "PM" | "EVE";

export const HALF_DAY_LABELS: Record<HalfDay, string> = {
  AM: "上午",
  PM: "下午",
  EVE: "晚上",
};

export const HALF_DAYS: readonly HalfDay[] = ["AM", "PM", "EVE"];

/**
 * 第几节算哪个半天。本校 1–4 节上午、5–8 节下午、9 节起晚上，
 * 和导出表的「上午/下午/晚上」行标签一致。别的学校若不同，改这一处。
 */
export function halfDayOf(periodStart: number): HalfDay {
  if (periodStart <= 4) return "AM";
  if (periodStart <= 8) return "PM";
  return "EVE";
}

export const WEEKDAY_LABELS = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

/** 解析出来的一条课表条目，字段与 TimetableSlot 一致 */
export type ParsedSlot = {
  /** 1 = 周一 … 7 = 周日 */
  weekday: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  weeksText: string;
  courseName: string;
  className: string | null;
  location: string | null;
  rawText: string;
};

/** 表里顺带写着的学期信息。缺哪项就 null，不猜 */
export type SemesterHint = {
  /** 「2026-2027学年第1学期」→「2026-2027-1」，和设置页的习惯写法一致 */
  name: string | null;
  /** YYYY-MM-DD */
  startDate: string | null;
  endDate: string | null;
  totalWeeks: number | null;
  teacherName: string | null;
};

export type SkippedEntry = { weekday: number; text: string; reason: string };

export type TimetableParseResult = {
  slots: ParsedSlot[];
  semester: SemesterHint;
  /** 认不出来的条目。预览里列出来让人看，不静默丢 */
  skipped: SkippedEntry[];
};

const WEEKDAY_BY_LABEL: Record<string, number> = {
  星期一: 1,
  星期二: 2,
  星期三: 3,
  星期四: 4,
  星期五: 5,
  星期六: 6,
  星期日: 7,
  星期天: 7,
  周一: 1,
  周二: 2,
  周三: 3,
  周四: 4,
  周五: 5,
  周六: 6,
  周日: 7,
};

/**
 * 周次原文 → 展开的周次列表。
 * 认「10-13周」「13周,18-19周」「1-16周(单)」「2-16双周」这几种；
 * 分隔符中英文逗号、顿号都算。认不出任何数字返回空数组，由调用方决定怎么报。
 */
export function parseWeeksText(text: string): number[] {
  const weeks = new Set<number>();
  for (const segment of text.split(/[,，、]/)) {
    const match = /(\d+)\s*(?:-\s*(\d+))?\s*(?:周)?\s*(?:[(（]?\s*([单双])\s*[)）]?)?/.exec(segment);
    if (!match) continue;
    const from = Number(match[1]);
    const to = match[2] ? Number(match[2]) : from;
    const parity = match[3];
    if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) continue;
    for (let week = from; week <= to; week += 1) {
      if (parity === "单" && week % 2 === 0) continue;
      if (parity === "双" && week % 2 === 1) continue;
      weeks.add(week);
    }
  }
  return [...weeks].sort((a, b) => a - b);
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/　/g, " ").trim();
}

function blankToNull(value: string | undefined): string | null {
  const text = clean(value);
  return text === "" ? null : text;
}

/** 中文数字的大节编号 → 节次区间。只在条目里没写「(1-2节)」时兜底 */
const BIG_PERIOD_INDEX: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
};

/**
 * 解析一格里的一条。字段顺序按表尾的注释：
 * 课程 / (节次)周次 / 校区 地点 / 教师 / 教学班 / 课堂名称 / 教学班组成 / 板块等级 / 场地类别。
 * 「课堂名称」几乎总是空，所以原文里是连着的「//」。
 */
function parseEntry(
  text: string,
  weekday: number,
  fallbackPeriod: [number, number] | null,
): ParsedSlot | SkippedEntry {
  const parts = text.split("/").map(clean);
  const courseName = parts[0] ?? "";
  if (courseName === "") {
    return { weekday, text, reason: "没有课程名" };
  }

  let periodStart: number | null = null;
  let periodEnd: number | null = null;
  let weeksText = "";

  const periodMatch = /\(\s*(\d+)\s*(?:-\s*(\d+))?\s*节\s*\)\s*(.*)$/.exec(parts[1] ?? "");
  if (periodMatch) {
    periodStart = Number(periodMatch[1]);
    periodEnd = periodMatch[2] ? Number(periodMatch[2]) : periodStart;
    weeksText = clean(periodMatch[3]);
  } else {
    // 没写节次的格式：整条里找「…周」那一段当周次，节次用行标签兜底
    const weeksMatch = /([\d\-,，、\s()（）单双]+周[()（）单双]*)/.exec(text);
    weeksText = clean(weeksMatch?.[1]);
    if (fallbackPeriod) [periodStart, periodEnd] = fallbackPeriod;
  }

  if (periodStart == null || periodEnd == null) {
    return { weekday, text, reason: "没找到节次" };
  }
  const weeks = parseWeeksText(weeksText);
  if (weeks.length === 0) {
    return { weekday, text, reason: "没找到周次" };
  }

  return {
    weekday,
    periodStart,
    periodEnd,
    weeks,
    weeksText,
    courseName,
    // 教学班组成在第 7 段；短格式（没有那么多段）就没有班级
    className: parts.length >= 7 ? blankToNull(parts[6]) : null,
    location: blankToNull(parts[2]),
    rawText: text,
  };
}

function isSkipped(value: ParsedSlot | SkippedEntry): value is SkippedEntry {
  return "reason" in value;
}

/** 从整张表的文字里捞学期信息。找不到的项留 null */
export function extractSemesterHint(grid: string[][]): SemesterHint {
  const hint: SemesterHint = {
    name: null,
    startDate: null,
    endDate: null,
    totalWeeks: null,
    teacherName: null,
  };
  for (const row of grid) {
    for (const cell of row) {
      const text = clean(cell);
      if (text === "") continue;

      const name = /(\d{4})\s*[-–]\s*(\d{4})\s*学年\s*第\s*(\d)\s*学期/.exec(text);
      if (name && hint.name == null) hint.name = `${name[1]}-${name[2]}-${name[3]}`;

      const teacher = /^(.{1,10}?)老师的课表$/.exec(text);
      if (teacher && hint.teacherName == null) hint.teacherName = teacher[1];

      const range =
        /本学期\s*(\d{4}-\d{1,2}-\d{1,2})\s*正式上课至\s*(\d{4}-\d{1,2}-\d{1,2})\s*结束\s*[,，]?\s*共\s*(\d+)\s*周/.exec(
          text,
        );
      if (range) {
        hint.startDate = normalizeYmd(range[1]);
        hint.endDate = normalizeYmd(range[2]);
        hint.totalWeeks = Number(range[3]);
      }
    }
  }
  return hint;
}

function normalizeYmd(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value ?? "");
  if (!match) return null;
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

/**
 * 整张表 → 条目。找不到「星期一 … 星期日」那行表头就当不是课表，抛错。
 */
export function parseTimetableGrid(grid: string[][]): TimetableParseResult {
  let headerRow = -1;
  const weekdayByColumn = new Map<number, number>();
  for (let r = 0; r < grid.length && headerRow < 0; r += 1) {
    const found = new Map<number, number>();
    grid[r]?.forEach((cell, c) => {
      const weekday = WEEKDAY_BY_LABEL[clean(cell)];
      if (weekday) found.set(c, weekday);
    });
    if (found.size >= 5) {
      headerRow = r;
      for (const [column, weekday] of found) weekdayByColumn.set(column, weekday);
    }
  }
  if (headerRow < 0) {
    throw new Error("没找到「星期一 … 星期日」那一行，这不像教务系统导出的课表");
  }

  const slots: ParsedSlot[] = [];
  const skipped: SkippedEntry[] = [];

  for (let r = headerRow + 1; r < grid.length; r += 1) {
    const row = grid[r] ?? [];
    // 表尾的「注--」整行合并，落在第一列
    if (/^注/.test(clean(row[0]))) break;

    // 行标签里的大节编号，只做兜底
    let fallbackPeriod: [number, number] | null = null;
    for (let c = 0; c < row.length; c += 1) {
      if (weekdayByColumn.has(c)) continue;
      const index = BIG_PERIOD_INDEX[clean(row[c])];
      if (index) fallbackPeriod = [index * 2 - 1, index * 2];
    }

    for (const [column, weekday] of weekdayByColumn) {
      const cell = clean(row[column]);
      if (cell === "") continue;
      for (const line of cell.split(/\r?\n|\r/)) {
        const text = clean(line);
        if (text === "") continue;
        const parsed = parseEntry(text, weekday, fallbackPeriod);
        if (isSkipped(parsed)) skipped.push(parsed);
        else slots.push(parsed);
      }
    }
  }

  return {
    slots: mergeAdjacentPeriods(slots),
    semester: extractSemesterHint(grid),
    skipped,
  };
}

/**
 * 教务系统把一个上午的 4 节课拆成「1-2节」「3-4节」两行、内容一模一样。
 * 同一天、同一门课、同周次、同地点、同班级、节次首尾相接的合成一条，
 * **但不跨半天**——3-4 节和 5-6 节合成 3-6 节之后，它就只算上午的课了。
 */
export function mergeAdjacentPeriods(slots: ParsedSlot[]): ParsedSlot[] {
  const sorted = [...slots].sort(
    (a, b) => a.weekday - b.weekday || a.periodStart - b.periodStart || a.courseName.localeCompare(b.courseName, "zh-CN"),
  );
  const merged: ParsedSlot[] = [];
  for (const slot of sorted) {
    const previous = merged.find(
      (candidate) =>
        candidate.weekday === slot.weekday &&
        candidate.courseName === slot.courseName &&
        candidate.weeksText === slot.weeksText &&
        candidate.location === slot.location &&
        candidate.className === slot.className &&
        candidate.periodEnd + 1 === slot.periodStart &&
        halfDayOf(candidate.periodStart) === halfDayOf(slot.periodStart),
    );
    if (previous) {
      previous.periodEnd = slot.periodEnd;
      previous.rawText = `${previous.rawText}\n${slot.rawText}`;
    } else {
      merged.push({ ...slot, weeks: [...slot.weeks] });
    }
  }
  return merged;
}

// ── 本周视图 ──

export type SlotLike = {
  id: string;
  weekday: number;
  periodStart: number;
  periodEnd: number;
  weeks: number[];
  courseName: string;
  className: string | null;
  location: string | null;
};

/** 第 week 教学周里星期 weekday 那天的纯日期。开学日是周一是排课表的口径（lib/semester.ts） */
export function dateOfTeachingDay(startDate: Date, week: number, weekday: number): Date {
  return new Date(startDate.getTime() + ((week - 1) * 7 + (weekday - 1)) * 86_400_000);
}

/** 某个纯日期落在该学期的第几周、星期几；开学前或超出量程（lib/semester.ts）返回 null */
export function teachingPosition(
  startDate: Date,
  date: Date,
): { week: number; weekday: number } | null {
  const days = diffInDays(date, startDate);
  if (days < 0) return null;
  const week = Math.floor(days / 7) + 1;
  if (week > MAX_TEACHING_WEEKS) return null;
  return { week, weekday: (days % 7) + 1 };
}

export type HomeTimetableWeek = {
  semester: { id: string; name: string; startDate: Date };
  week: number;
  /** 还没开学、但七天内开学：提前把第一周摆出来 */
  upcoming: boolean;
};

export type SemesterWithId = SemesterLike & { id: string };

/**
 * 首页该显示哪个学期的第几周。
 * 开学了就是当前教学周；七天内开学就提前显示第 1 周（下周一的课今天就想知道）；
 * 其余情况 null，首页不画这张卡——假期里画一张空课表是噪音。
 */
export function homeTimetableWeek(
  semesters: SemesterWithId[],
  today: Date,
): HomeTimetableWeek | null {
  const status = semesterStatus(semesters, today);
  if (!status) return null;
  const semester = semesters.find((item) => item.name === status.name);
  if (!semester) return null;
  if (status.kind === "week") return { semester, week: status.week, upcoming: false };
  if (diffInDays(status.startDate, today) <= 7) return { semester, week: 1, upcoming: true };
  return null;
}

export type WeekTimetableEntry = {
  id: string;
  courseName: string;
  className: string | null;
  location: string | null;
  /** 「1-4节」 */
  periodText: string;
};

export type WeekTimetableDay = {
  weekday: number;
  label: string;
  /** 「9/7」 */
  dateText: string;
  /** YYYY-MM-DD */
  date: string;
  isToday: boolean;
  cells: Record<HalfDay, WeekTimetableEntry[]>;
};

export type WeekTimetable = {
  days: WeekTimetableDay[];
  /** 要画哪几列。晚上没课就不画那一列，布局按整学期定，不随周跳 */
  halfDays: HalfDay[];
  /** 本周有几个半天有课 */
  busyHalfDays: number;
};

export function formatPeriodRange(periodStart: number, periodEnd: number): string {
  return periodStart === periodEnd ? `第${periodStart}节` : `${periodStart}-${periodEnd}节`;
}

/** 教学班组成「数字媒体2601;数字媒体2602」→「数字媒体2601、数字媒体2602」 */
export function formatClassName(className: string | null): string | null {
  if (!className) return null;
  return className
    .split(/[;；]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join("、");
}

/**
 * 把整学期的条目裁成某一周的表。
 * 列（半天）和行（周几）按**整学期**有没有课决定，不按本周：
 * 这周周六没课就把周六那行抽掉，卡片每周变一个形状，反而看不出「今天是哪行」。
 * 周一到周五永远在。
 */
export function buildWeekTimetable(
  slots: SlotLike[],
  startDate: Date,
  week: number,
  today: Date,
): WeekTimetable {
  const halfDays = HALF_DAYS.filter(
    (halfDay) => halfDay !== "EVE" || slots.some((slot) => halfDayOf(slot.periodStart) === "EVE"),
  );
  const weekdays = [1, 2, 3, 4, 5, 6, 7].filter(
    (weekday) => weekday <= 5 || slots.some((slot) => slot.weekday === weekday),
  );
  const todayYmd = formatDateOnly(today);

  let busyHalfDays = 0;
  const days = weekdays.map((weekday) => {
    const date = dateOfTeachingDay(startDate, week, weekday);
    const cells: Record<HalfDay, WeekTimetableEntry[]> = { AM: [], PM: [], EVE: [] };
    for (const slot of slots) {
      if (slot.weekday !== weekday || !slot.weeks.includes(week)) continue;
      cells[halfDayOf(slot.periodStart)].push({
        id: slot.id,
        courseName: slot.courseName,
        className: slot.className,
        location: slot.location,
        periodText: formatPeriodRange(slot.periodStart, slot.periodEnd),
      });
    }
    for (const halfDay of halfDays) {
      cells[halfDay].sort((a, b) => a.periodText.localeCompare(b.periodText));
      if (cells[halfDay].length > 0) busyHalfDays += 1;
    }
    return {
      weekday,
      label: WEEKDAY_LABELS[weekday] ?? "",
      dateText: `${date.getUTCMonth() + 1}/${date.getUTCDate()}`,
      date: formatDateOnly(date),
      isToday: formatDateOnly(date) === todayYmd,
      cells,
    };
  });

  return { days, halfDays, busyHalfDays };
}
