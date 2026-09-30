/**
 * 平台事件 → iCalendar 文件（RFC 5545），给手机自带日历导入用。
 *
 * 平台自己不发提醒（PRD 第 7 节：不做微信/邮件推送），到点响铃交给手机日历。
 * 三条口径：
 *
 * - **两种事件、两套提醒。** 会议有时刻，是「定时事件」，提醒前一天 + 提前 30 分钟；
 *   截止日和任务只到日（`@db.Date`），是「全天事件」，提醒前一天 20:00 + 当天 8:00。
 *   **不从标题里抠「8:30」把全天事件升级成定时**（CLAUDE.md 第 8 条铁律）
 * - **单向导出，不做订阅**。订阅要在免登录白名单上再开一个口子；
 *   改期不跟着变，靠「删掉旧的重新加一次」兜住
 * - **只放标题、时间和回跳链接**。议程、纪要、备注不进文件——
 *   进了手机日历就会随 iCloud 同步出去，而这些内容属个人域
 */

import { formatDateOnly } from "@/lib/date";

export type IcsEvent = {
  /** 固定不变，同一件事导几次都是同一个事件标识 */
  uid: string;
  summary: string;
  url?: string;
} & (
  | { allDay: false; start: Date; end: Date }
  /** 纯日期，UTC 午夜表示（lib/date.ts 的约定） */
  | { allDay: true; date: Date }
);

/**
 * 定时事件的两条提醒：前一天（准备材料）+ 提前 30 分钟（动身）。
 * iPhone 日历一个事件最多认两条提醒，再加就被丢掉
 */
export const TIMED_ALARM_TRIGGERS = ["-P1D", "-PT30M"] as const;

/**
 * 全天事件的两条提醒：前一天 20:00 + 当天 08:00（2026-09-22 用户定）。
 * 全天事件的相对触发以当天本地 0 点为基准：-PT4H 落在前一天晚上八点，
 * PT8H 落在当天早上八点——和 iPhone 自己「前一天（上午 9 点）」写成 -PT15H 是同一种写法
 */
export const ALL_DAY_ALARM_TRIGGERS = ["-PT4H", "PT8H"] as const;

export function buildIcs(event: IcsEvent, options: { now?: Date } = {}): string {
  const now = options.now ?? new Date();
  const summary = escapeIcsText(event.summary);
  const triggers = event.allDay ? ALL_DAY_ALARM_TRIGGERS : TIMED_ALARM_TRIGGERS;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//teacher-desk//calendar//ZH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${formatIcsUtc(now)}`,
    ...(event.allDay
      ? [
          // 全天事件写 DATE 不带时区，手机按自己的日历日显示；DTEND 是开区间，写第二天
          `DTSTART;VALUE=DATE:${formatIcsDate(event.date)}`,
          `DTEND;VALUE=DATE:${formatIcsDate(new Date(event.date.getTime() + 86_400_000))}`,
        ]
      : [
          // 定时事件一律写 UTC（带 Z），省掉 VTIMEZONE 块；手机按自己的时区显示
          `DTSTART:${formatIcsUtc(event.start)}`,
          `DTEND:${formatIcsUtc(event.end)}`,
        ]),
    `SUMMARY:${summary}`,
    ...(event.url ? [`URL:${event.url}`] : []),
    ...triggers.flatMap((trigger) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `TRIGGER:${trigger}`,
      // DISPLAY 类提醒 DESCRIPTION 是必填项，缺了严格的客户端会整条丢弃
      `DESCRIPTION:${summary}`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

// ─── 会议 ────────────────────────────────────────────────────────────

export type IcsMeeting = {
  id: string;
  title: string;
  meetingTime: Date;
};

/** Meeting 只存了开始时刻，而日历事件得有个长度。1 小时是占位，手机上可以自己拖 */
export const MEETING_PLACEHOLDER_DURATION_MS = 60 * 60 * 1000;

export function buildMeetingIcs(
  meeting: IcsMeeting,
  options: { url?: string; now?: Date } = {},
): string {
  return buildIcs(
    {
      uid: `meeting-${meeting.id}@teacher-desk`,
      summary: meeting.title,
      url: options.url,
      allDay: false,
      start: meeting.meetingTime,
      end: new Date(meeting.meetingTime.getTime() + MEETING_PLACEHOLDER_DURATION_MS),
    },
    { now: options.now },
  );
}

// ─── HTTP 响应 ───────────────────────────────────────────────────────

/**
 * 四个下载接口共用的响应头。
 *
 * **Content-Disposition 必须是 attachment，不是 inline**（2026-09-22 真机验出来的）。
 * 09-17 上线时写的 inline，以为 iPhone Safari 会直接弹「添加到日历」——实际是点了
 * 没任何反应：Safari 对内联的 text/calendar 处理不稳定，多数时候直接吞掉。
 * attachment 走的是 Safari 的下载器：点按钮 → 工具栏出现下载箭头 → 点开文件 →
 * 日历预览页 → 「添加全部」。多一步，但每次都走得通。
 * URL 里不带标题也不带 .ics 后缀（CLAUDE.md：文件名一律不进 URL），文件名从这里还原
 */
export function icsResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // RFC 5987：中文文件名走 filename*，filename 留个 ASCII 兜底
      "Content-Disposition": `attachment; filename="event.ics"; filename*=UTF-8''${encodeURIComponent(`${filename}.ics`)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}

// ─── 格式 ────────────────────────────────────────────────────────────

/** `20260918T063000Z`。按 UTC 取，跟进程时区无关 */
export function formatIcsUtc(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}` +
    `T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`
  );
}

/** `20260925`。纯日期按 UTC 口径取年月日（lib/date.ts） */
export function formatIcsDate(value: Date): string {
  return formatDateOnly(value).replace(/-/g, "");
}

/** TEXT 类型的转义：反斜杠、分号、半角逗号、换行。全角标点不用管 */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * 长行折叠：每个物理行不超过 75 个**字节**，续行以一个空格开头。
 *
 * 按字节不按字符——一个汉字 3 字节，按字符数折的话 30 个字的标题就超了。
 * 逐码点累加，**不在一个字的中间断开**：断在 UTF-8 多字节序列中间，
 * 有的客户端拼回来是乱码
 */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  let limit = 75;

  for (const char of line) {
    const size = utf8Length(char.codePointAt(0)!);
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
      // 续行开头那个空格也算在 75 里
      limit = 74;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);

  return parts.join("\r\n ");
}

function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
