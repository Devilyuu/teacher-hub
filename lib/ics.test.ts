import { describe, expect, it } from "vitest";
import { dateOnly } from "@/lib/date";
import {
  buildIcs,
  buildMeetingIcs,
  escapeIcsText,
  foldIcsLine,
  formatIcsDate,
  formatIcsUtc,
  icsResponse,
} from "@/lib/ics";

/** 一律用 UTC 构造，测试结果不随跑测试那台机器的时区变 */
const MEETING = {
  id: "cm0meeting",
  title: "系部例会",
  // 北京时间 2026-09-18 14:30
  meetingTime: new Date(Date.UTC(2026, 8, 18, 6, 30)),
};
const NOW = new Date(Date.UTC(2026, 8, 17, 1, 2, 3));

/** 按 RFC 5545 把折叠行拼回去，再拆成逻辑行 */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n /g, "").split("\r\n").filter(Boolean);
}

describe("buildMeetingIcs", () => {
  it("行尾一律 CRLF，文件以 CRLF 结尾，没有裸 LF", () => {
    const ics = buildMeetingIcs(MEETING, { now: NOW });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("开始时间写 UTC，结束时间是开始后 1 小时的占位", () => {
    const lines = unfold(buildMeetingIcs(MEETING, { now: NOW }));
    expect(lines).toContain("DTSTART:20260918T063000Z");
    expect(lines).toContain("DTEND:20260918T073000Z");
    expect(lines).toContain("DTSTAMP:20260917T010203Z");
  });

  it("两条提醒：前一天 + 提前 30 分钟，各自带必填的 DESCRIPTION", () => {
    const lines = unfold(buildMeetingIcs(MEETING, { now: NOW }));
    expect(lines.filter((line) => line === "BEGIN:VALARM")).toHaveLength(2);
    expect(lines.filter((line) => line.startsWith("TRIGGER:"))).toEqual([
      "TRIGGER:-P1D",
      "TRIGGER:-PT30M",
    ]);
    expect(lines.filter((line) => line === "DESCRIPTION:系部例会")).toHaveLength(2);
  });

  it("UID 按会议 id 固定，导几次都一样", () => {
    const first = unfold(buildMeetingIcs(MEETING, { now: NOW }));
    const second = unfold(buildMeetingIcs(MEETING, { now: new Date() }));
    const uid = (lines: string[]) => lines.find((line) => line.startsWith("UID:"));
    expect(uid(first)).toBe("UID:meeting-cm0meeting@teacher-desk");
    expect(uid(second)).toBe(uid(first));
  });

  it("给了回跳链接才写 URL", () => {
    const withUrl = unfold(
      buildMeetingIcs(MEETING, { now: NOW, url: "https://desk.example.com/meetings/cm0meeting" }),
    );
    expect(withUrl).toContain("URL:https://desk.example.com/meetings/cm0meeting");
    expect(unfold(buildMeetingIcs(MEETING, { now: NOW })).some((line) => line.startsWith("URL:"))).toBe(false);
  });

  it("只放标题、时间和链接，不带议程纪要这类字段", () => {
    const lines = unfold(buildMeetingIcs(MEETING, { now: NOW }));
    expect(lines.some((line) => /^(LOCATION|ATTENDEE|ORGANIZER)[:;]/.test(line))).toBe(false);
    // 唯一的 DESCRIPTION 是提醒里的标题
    expect(lines.filter((line) => line.startsWith("DESCRIPTION:")).every((line) => line === "DESCRIPTION:系部例会")).toBe(true);
  });

  it("标题里的分号逗号换行被转义，全角标点原样", () => {
    const lines = unfold(
      buildMeetingIcs({ ...MEETING, title: "迎评会;材料A,B，第二轮\n补充" }, { now: NOW }),
    );
    expect(lines).toContain("SUMMARY:迎评会\\;材料A\\,B，第二轮\\n补充");
  });

  it("超长中文标题折叠后每个物理行不超过 75 字节，拼回去和原文一致", () => {
    const title = "关于二〇二六年度省级职业教育教学改革研究课题中期检查材料报送与专家论证安排的专题会议";
    const ics = buildMeetingIcs({ ...MEETING, title }, { now: NOW });
    for (const physical of ics.split("\r\n")) {
      expect(Buffer.byteLength(physical, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(unfold(ics)).toContain(`SUMMARY:${title}`);
  });
});

describe("buildIcs · 全天事件", () => {
  const deadline = {
    uid: "project-p1-closing@teacher-desk",
    summary: "结题截止·VR/AR 平台",
    allDay: true as const,
    date: dateOnly(2026, 9, 25),
  };

  it("DTSTART/DTEND 写 DATE 不带时刻，DTEND 是第二天（开区间）", () => {
    const lines = unfold(buildIcs(deadline, { now: NOW }));
    expect(lines).toContain("DTSTART;VALUE=DATE:20260925");
    expect(lines).toContain("DTEND;VALUE=DATE:20260926");
    expect(lines.some((line) => /^DT(START|END):/.test(line))).toBe(false);
  });

  it("月末跨月：9 月 30 日的 DTEND 是 10 月 1 日", () => {
    const lines = unfold(buildIcs({ ...deadline, date: dateOnly(2026, 9, 30) }, { now: NOW }));
    expect(lines).toContain("DTEND;VALUE=DATE:20261001");
  });

  it("提醒是前一天 20:00 + 当天 08:00，不是定时事件那两条", () => {
    const lines = unfold(buildIcs(deadline, { now: NOW }));
    expect(lines.filter((line) => line.startsWith("TRIGGER:"))).toEqual([
      "TRIGGER:-PT4H",
      "TRIGGER:PT8H",
    ]);
  });

  it("uid 原样写入，url 可选", () => {
    const lines = unfold(buildIcs({ ...deadline, url: "https://desk.example.com/projects/p1" }, { now: NOW }));
    expect(lines).toContain("UID:project-p1-closing@teacher-desk");
    expect(lines).toContain("URL:https://desk.example.com/projects/p1");
  });
});

describe("icsResponse", () => {
  // attachment 不是 inline：iPhone Safari 对内联 text/calendar 多半没反应（真机验过）
  it("attachment 的 text/calendar，中文文件名走 filename*，不缓存", async () => {
    const response = icsResponse("BEGIN:VCALENDAR\r\n", "结题截止·VR 平台");
    expect(response.headers.get("Content-Type")).toBe("text/calendar; charset=utf-8");
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="event.ics"; filename*=UTF-8''${encodeURIComponent("结题截止·VR 平台.ics")}`,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.text()).toBe("BEGIN:VCALENDAR\r\n");
  });
});

describe("formatIcsDate", () => {
  it("纯日期按 UTC 取，不带分隔符", () => {
    expect(formatIcsDate(dateOnly(2026, 1, 5))).toBe("20260105");
  });
});

describe("formatIcsUtc", () => {
  it("补零且带 Z", () => {
    expect(formatIcsUtc(new Date(Date.UTC(2027, 0, 5, 3, 4, 5)))).toBe("20270105T030405Z");
  });
});

describe("escapeIcsText", () => {
  it("反斜杠先转义，不会把后面加的转义符再转一遍", () => {
    expect(escapeIcsText("a\\b;c")).toBe("a\\\\b\\;c");
  });
});

describe("foldIcsLine", () => {
  it("75 字节以内原样返回", () => {
    const line = `SUMMARY:${"a".repeat(67)}`;
    expect(foldIcsLine(line)).toBe(line);
  });

  it("不在汉字中间断开：每段都是完整字符，续行以一个空格开头", () => {
    const line = `SUMMARY:${"会".repeat(60)}`;
    const folded = foldIcsLine(line);
    const segments = folded.split("\r\n");
    expect(segments.length).toBeGreaterThan(1);
    for (const [index, segment] of segments.entries()) {
      const body = index === 0 ? segment : segment.slice(1);
      if (index > 0) expect(segment.startsWith(" ")).toBe(true);
      expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(75);
      // 除了 SUMMARY: 前缀，剩下的只能是整字
      expect(body.replace("SUMMARY:", "")).toMatch(/^会*$/);
    }
    expect(folded.replace(/\r\n /g, "")).toBe(line);
  });

  it("四字节字符（emoji）也不拆开", () => {
    const line = `SUMMARY:${"🎓".repeat(30)}`;
    const folded = foldIcsLine(line);
    expect(folded.replace(/\r\n /g, "")).toBe(line);
    for (const segment of folded.split("\r\n")) {
      expect(Buffer.byteLength(segment, "utf8")).toBeLessThanOrEqual(75);
      expect(segment).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
