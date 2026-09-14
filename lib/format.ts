import { formatDateOnly, formatYearMonth, formatYearOnly } from "@/lib/date";
import type { DatePrecision } from "@/lib/generated/prisma/enums";

/** 全站日期一律 YYYY-MM-DD（CLAUDE.md 代码约定） */
export function formatDate(value: Date | null | undefined): string {
  return value ? formatDateOnly(value) : "—";
}

/**
 * 按精度渲染日期。精度不到日就不显示到日——存量数据里绝大多数只有
 * 精确到日，把"2016—2017年"显示成 2016-01-01 就是在制造假数据。
 *
 * 什么都没有时返回的占位是 **「日期未填」不是「待确认」**：
 * 后者是成果核实状态徽章的词（`isVerified` 为假），两者出现在同一行里，
 * 撞词会让人以为「这条日期没确认」和「这条成果没核实」是一回事。
 *
 * @param dateText 原始时间表述，精度为 RANGE / UNKNOWN 时它才是唯一可信的东西
 */
export const DATE_UNFILLED = "日期未填";

export function formatDateByPrecision(
  value: Date | null | undefined,
  precision: DatePrecision,
  dateText?: string | null,
): string {
  if (precision === "RANGE" || precision === "UNKNOWN") {
    return dateText?.trim() || DATE_UNFILLED;
  }
  if (!value) return dateText?.trim() || DATE_UNFILLED;

  switch (precision) {
    case "YEAR":
      return formatYearOnly(value);
    case "MONTH":
      return formatYearMonth(value);
    case "DAY":
      return formatDateOnly(value);
  }
}

/** 倒计时文案。null 表示没填截止日，负数表示已逾期 */
export function formatDaysLeft(daysLeft: number | null): string {
  if (daysLeft == null) return "未设截止日";
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 天`;
  if (daysLeft === 0) return "今天截止";
  return `剩余 ${daysLeft} 天`;
}

/** 完成度。null 一律显示"—"，绝不显示 0%（PRD 第 3 节硬规则） */
export function formatCompletionRate(rate: number | null): string {
  return rate == null ? "—" : `${Math.round(rate * 100)}%`;
}

/**
 * 人类可读的文件大小。
 * 放在这里而不是 lib/storage.ts——后者引了 node:fs，
 * 客户端组件 import 它会把 Node 内置模块拖进浏览器包，直接编译失败。
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 时间戳（`DateTime` 列，如 uploadedAt/createdAt）渲染成 YYYY-MM-DD。
 *
 * 和 `lib/date.ts` 的 `formatDateOnly` 是两回事，别混用：那边处理的是
 * `@db.Date` 纯日期，按 UTC 取年月日；这里是带时刻的真时间戳，必须按**本地**
 * 时区取——东八区上午 8 点前上传的文件，用 UTC 口径会显示成前一天。
 */
export function formatTimestampDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** 缺口文案 */
export function formatGap(totalGap: number, totalRequired: number): string {
  if (totalRequired === 0) return "未录结题要求";
  return totalGap === 0 ? "要求已齐备" : `还差 ${totalGap} 项`;
}

/**
 * 时间戳渲染成「2026-07-08 14:30 周三」。会议列表与日历用。
 *
 * 与 `formatTimestampDate` 同一套口径（本地时区），只是带上时刻和星期——
 * 会议这类事「周几」比日期更好认，排期时人是按周想的。
 */
export function formatTimestamp(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][date.getDay()];
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())} ${weekday}`;
}
