/**
 * 首页「开始使用」那一块：新装的人要先做的三件事。纯函数，查询在 components/getting-started.tsx。
 *
 * 放首页是因为首页只放能被处理掉的事（CLAUDE.md），而这正是三件要处理的事——
 * 空台账、空分类表、空课表时，首页和导出都没什么可看的，而新用户不知道先去哪。
 * **做完的由数据自动勾上、全做完整块消失**，不靠人点「完成」；
 * 有人就是不导课表（这学期没课），所以另给一个「不再显示」，记在这个浏览器的 cookie 里。
 */
export const GETTING_STARTED_DISMISSED_COOKIE = "td_getting_started_dismissed";

export type GettingStartedFacts = {
  profile: { name: string; unit: string; currentTitleSince: Date | null } | null;
  /** 当前在用那一版的条数，没导过就是 0（lib/queries/rule-tables.ts 的 getRuleTablesSummary） */
  promotionCategories: number;
  perfCategories: number;
  timetableSlots: number;
};

export type GettingStartedStep = {
  key: "profile" | "rules" | "timetable";
  title: string;
  detail: string;
  href: string;
  action: string;
  done: boolean;
};

export function gettingStartedSteps(facts: GettingStartedFacts): GettingStartedStep[] {
  const profile = facts.profile;
  return [
    {
      key: "profile",
      title: "填我的档案",
      detail: "姓名、单位是导出申报表时要填的；任现职日期决定职称表从哪一年开始算。",
      href: "/profile",
      action: "去填写",
      // 任现职日期缺了职称表照样能导，只是取数没有下限（导出页会照实说）——但新用户多半是漏了，不是没有
      done: Boolean(profile?.name.trim() && profile.unit.trim() && profile.currentTitleSince),
    },
    {
      key: "rules",
      title: "导入职称表和绩效表",
      detail: "同校同事发来的「规则包」文件直接导入；没有的话，把学校发的表格复制粘贴进来。",
      href: "/settings/rules/import",
      action: "去导入",
      done: facts.promotionCategories > 0 && facts.perfCategories > 0,
    },
    {
      key: "timetable",
      title: "导入课表",
      detail: "教务系统导出的 .xls。导进来以后，首页会显示这周哪几个半天走不开。",
      href: "/settings/timetable",
      action: "去导入",
      done: facts.timetableSlots > 0,
    },
  ];
}

export function shouldShowGettingStarted(steps: GettingStartedStep[], dismissed: boolean): boolean {
  return !dismissed && steps.some((step) => !step.done);
}
