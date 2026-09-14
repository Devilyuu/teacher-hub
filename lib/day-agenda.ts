/**
 * 首页问候带那一行：「今天哪几个半天被什么占着」。
 *
 * 纯函数，不碰数据库（取数在 lib/queries/day-agenda.ts）。
 * 它和下面的数字卡、列表分工：数字卡数「有几件事」，这一行只回答
 * **时间上走不开的是哪几段**——课和会，别的一概不放。
 *
 * 三条口径：
 *
 * - **18 点以后改说明天**。晚上打开还看到一张今天的日程，那一行就是废话
 * - **半天沿用课表那一处**（lib/timetable.ts 的 halfDayOf）。会议没有节次，
 *   按时刻折：12 点前上午、18 点前下午、之后晚上
 * - **课表没导入时绝不说「没有课」**。那是猜，不是事实（第 8 条铁律同理）；
 *   只报会，并提示去导入。假期里（有学期但不在教学周）同样不提课
 */
import { dateOnly, formatDateOnly } from "@/lib/date";
import { formatTimestampDate } from "@/lib/format";
import { semesterStatus, type SemesterLike } from "@/lib/semester";
import {
  formatPeriodRange,
  HALF_DAY_LABELS,
  halfDayOf,
  teachingPosition,
  WEEKDAY_LABELS,
  type HalfDay,
  type SlotLike,
} from "@/lib/timetable";

/** 几点以后问候带改说明天 */
export const AGENDA_TOMORROW_FROM_HOUR = 18;

/** 「下一节课」往后找几天。超过两周基本是放假了，报一个很远的日子没用 */
const NEXT_CLASS_LOOKAHEAD_DAYS = 14;

export type AgendaTarget = {
  /** 纯日期（UTC 午夜，lib/date.ts 的约定） */
  date: Date;
  isTomorrow: boolean;
};

/** 问候带说的是哪一天 */
export function agendaTarget(now: Date): AgendaTarget {
  const isTomorrow = now.getHours() >= AGENDA_TOMORROW_FROM_HOUR;
  const date = dateOnly(now.getFullYear(), now.getMonth() + 1, now.getDate() + (isTomorrow ? 1 : 0));
  return { date, isTomorrow };
}

/** 该学期某条课表用得上的字段 */
export type AgendaSlot = Pick<SlotLike, "weekday" | "periodStart" | "periodEnd" | "weeks" | "courseName" | "location">;

export type AgendaMeeting = { id: string; title: string; meetingTime: Date };

export type AgendaEntry =
  | { kind: "class"; key: string; text: string }
  | { kind: "meeting"; key: string; text: string; meetingId: string };

export type AgendaHalfDay = { halfDay: HalfDay; label: string; entries: AgendaEntry[] };

export type DayAgenda = {
  /** 「今天」或「明天 · 周三」 */
  lead: string;
  /**
   * known：在教学周里且课表导入过，可以说「没有课」；
   * not-imported：一个学期都没设，或当前学期一条课表都没有——提示去导入；
   * out-of-term：设了学期但这天不在教学周（假期），不提课也不催导入
   */
  timetable: "known" | "not-imported" | "out-of-term";
  /**
   * 课表已知时：上午、下午永远在（空着也画，「空着」本身就是答案），
   * 晚上有事才出现——多数老师没晚课，每天一句「晚上 空着」是噪音。
   * 课表未知时为空数组，界面改成只列会
   */
  halfDays: AgendaHalfDay[];
  /** 课表未知时这一天的会，按时刻排 */
  meetings: AgendaEntry[];
  /** 课表已知、这天没课也没会时，往后找到的第一节课 */
  nextClass: string | null;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 会议时刻 → 半天。会议是带时刻的时间戳，按本地时区取（CLAUDE.md 日期约定） */
export function halfDayOfMeeting(meetingTime: Date): HalfDay {
  const hour = meetingTime.getHours();
  if (hour < 12) return "AM";
  if (hour < AGENDA_TOMORROW_FROM_HOUR) return "PM";
  return "EVE";
}

function classText(slot: AgendaSlot): string {
  // 书名号自带留白，间隔号前不再加空格
  const location = slot.location ? `· ${slot.location}` : "";
  return `${formatPeriodRange(slot.periodStart, slot.periodEnd)}《${slot.courseName}》${location}`;
}

function meetingEntry(meeting: AgendaMeeting): AgendaEntry {
  const time = `${pad(meeting.meetingTime.getHours())}:${pad(meeting.meetingTime.getMinutes())}`;
  return { kind: "meeting", key: meeting.id, text: `${time} ${meeting.title}`, meetingId: meeting.id };
}

function classesOn(slots: AgendaSlot[], startDate: Date, date: Date): AgendaSlot[] {
  const position = teachingPosition(startDate, date);
  if (!position) return [];
  return slots
    .filter((slot) => slot.weekday === position.weekday && slot.weeks.includes(position.week))
    .sort((a, b) => a.periodStart - b.periodStart);
}

/** 纯日期的「周几」标签。不借教学周推：开学日不是周一的学校也要对 */
function weekdayLabel(date: Date): string {
  return WEEKDAY_LABELS[((date.getUTCDay() + 6) % 7) + 1] ?? "";
}

export function buildDayAgenda(input: {
  target: AgendaTarget;
  /** 全部学期。用它判断这一天落在哪个学期的教学周里 */
  semesters: SemesterLike[];
  /** 这一天所在学期的课表（不在教学周时传什么都不看） */
  slots: AgendaSlot[];
  /** 这一天的会（调用方按本地日界取好；这里再按本地日期核一遍） */
  meetings: AgendaMeeting[];
}): DayAgenda {
  const { target, semesters, slots } = input;
  const lead = target.isTomorrow ? `明天 · ${weekdayLabel(target.date)}` : "今天";
  const targetYmd = formatDateOnly(target.date);
  const meetings = input.meetings
    .filter((meeting) => formatTimestampDate(meeting.meetingTime) === targetYmd)
    .sort((a, b) => a.meetingTime.getTime() - b.meetingTime.getTime());

  const status = semesterStatus(semesters, target.date);
  const semester =
    status?.kind === "week" ? semesters.find((item) => item.name === status.name) ?? null : null;

  const timetable: DayAgenda["timetable"] =
    semesters.length === 0 || (semester != null && slots.length === 0)
      ? "not-imported"
      : semester == null
        ? "out-of-term"
        : "known";

  if (timetable !== "known" || semester == null) {
    return { lead, timetable, halfDays: [], meetings: meetings.map(meetingEntry), nextClass: null };
  }

  const cells: Record<HalfDay, AgendaEntry[]> = { AM: [], PM: [], EVE: [] };
  classesOn(slots, semester.startDate, target.date).forEach((slot, index) => {
    cells[halfDayOf(slot.periodStart)].push({ kind: "class", key: `class-${index}`, text: classText(slot) });
  });
  for (const meeting of meetings) cells[halfDayOfMeeting(meeting.meetingTime)].push(meetingEntry(meeting));

  const halfDays = (["AM", "PM", "EVE"] as const)
    .filter((halfDay) => halfDay !== "EVE" || cells.EVE.length > 0)
    .map((halfDay) => ({ halfDay, label: HALF_DAY_LABELS[halfDay], entries: cells[halfDay] }));

  const isFree = halfDays.every((cell) => cell.entries.length === 0);
  return {
    lead,
    timetable,
    halfDays,
    meetings: [],
    nextClass: isFree ? findNextClass(slots, semester.startDate, target.date) : null,
  };
}

/** 往后找第一节课：「9/15 周二上午 3-4节《三维动画设计》」。找不到返回 null */
function findNextClass(slots: AgendaSlot[], startDate: Date, from: Date): string | null {
  for (let offset = 1; offset <= NEXT_CLASS_LOOKAHEAD_DAYS; offset += 1) {
    const date = new Date(from.getTime() + offset * 86_400_000);
    const first = classesOn(slots, startDate, date)[0];
    if (!first) continue;
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()} ${weekdayLabel(date)}${HALF_DAY_LABELS[halfDayOf(first.periodStart)]} ${formatPeriodRange(first.periodStart, first.periodEnd)}《${first.courseName}》`;
  }
  return null;
}
