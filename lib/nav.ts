import {
  CalendarDays,
  Compass,
  FlaskConical,
  GraduationCap,
  ListTodo,
  Medal,
  Repeat,
  Trophy,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { moduleForPath, type ModuleVisibility } from "@/lib/modules";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * 这一项还统辖哪些路径（用于高亮）。
   * **导航分组不等于 URL 嵌套**（CLAUDE.md）：`/tasks`、`/meetings` 这些保持扁平，
   * 只是在导航上归到「日常」一项下面。
   */
  covers?: string[];
};

/**
 * 顶部导航全集：**首页 · 日常 · 科研 · 教学 · 参赛 · 班主任 · 成果**，
 * 顺序按使用频率不按重要性。实际渲染走 `navItemsFor(modules)`——
 * 可选模块（教学 / 参赛 / 班主任，见 lib/modules.ts）关掉就不出现。
 *
 * 「五项是上限」在模块开关时代先改写成「同时启用不超过 5 项」，
 * 2026-09-12 加「参赛」时**抬到 6 项**：默认可见是
 * 首页/日常/科研/教学/参赛/成果，全集 7 项。抬这一档是有代价的，
 * 记下来省得下次又当成没上限——导航本身是 `overflow-x-auto` 带渐隐指示，
 * 6 项在 1272px 内容区里排得下，真正的成本是**扫一眼要认的入口多了一个**。
 * 再往上加之前先问一句「它能不能是某一项下面的二级 tab」。
 *
 * 沿革（这一版相对旧版换过两处，理由留着）：
 * - 「课题」改叫**「科研」**。它是一个工作领域的名字，课题只是这个领域里的
 *   核心对象；将来放研究计划、研究资料进来时不用再改名。
 * - 「更多」（指向素材占位页）整个去掉，「教学」顶上。旧结构是倒过来的：
 *   一级入口点进去是没实现的占位页，已经做完的导出反而要从占位页里再点一次。
 *
 * 成果继续独立成一级，因为它**同时是科研和教学的产出**，挂在任何一边都不对。
 */
export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "首页",
    icon: Compass,
  },
  {
    href: "/tasks",
    label: "日常",
    icon: ListTodo,
    covers: ["/tasks", "/meetings", "/duties", "/calendar"],
  },
  {
    href: "/projects",
    label: "科研",
    icon: FlaskConical,
  },
  {
    href: "/teaching",
    label: "教学",
    icon: GraduationCap,
  },
  {
    // 指导参赛是与科研、教学并列的工作领域：它的大半价值在**出结果之前**
    // （报名截止、集训、比赛日期），塞进「成果」就只剩获奖那一刻了
    href: "/competitions",
    label: "参赛",
    icon: Medal,
  },
  {
    // 班主任是与科研、教学并列的工作领域，不塞进「日常」——
    // 日常是任务/会议这类个人事务的档案柜，学生工作是一个域
    href: "/students",
    label: "班主任",
    icon: UsersRound,
  },
  {
    href: "/achievements",
    label: "成果",
    icon: Trophy,
    covers: ["/achievements", "/export"],
  },
];

/**
 * 按模块开关过滤一级导航。骨架项（moduleForPath 返回 null 的）永远保留；
 * 可选模块关掉就整项消失——只从导航上消失，路由本身仍可访问
 * （会看到「未启用」提示页），数据一个字节不动。
 */
export function navItemsFor(modules: ModuleVisibility): NavItem[] {
  return NAV_ITEMS.filter((item) => {
    const key = moduleForPath(item.href);
    return key == null || modules[key];
  });
}

/**
 * 手机底部导航只放的那几项（2026-09-13 用户定）：首页 · 日常 · 科研 · 成果，
 * 参赛模块开着时加进去变五项。
 *
 * **只能是 NAV_ITEMS 的子集、顺序跟着全集走**，不另起一份名单——两处各存一份，
 * 早晚出现「底部栏叫科研、侧栏叫课题」这种裂缝。教学和班主任不进底栏：
 * 手机上底栏放五项已经是上限，再多每格就窄到认不出图标；它们和设置、退出
 * 一起收进顶栏的菜单抽屉，那里放的是全集。
 */
const MOBILE_TAB_HREFS = new Set(["/", "/tasks", "/projects", "/competitions", "/achievements"]);

export function mobileTabsFor(modules: ModuleVisibility): NavItem[] {
  return navItemsFor(modules).filter((item) => MOBILE_TAB_HREFS.has(item.href));
}

/**
 * 「日常」下面的二级导航。URL 全部扁平，不套 `/routines/` 前缀。
 *
 * `/duties` 界面上叫**「轮派」**而不是「值班」：它管的是监考、校级会议这类活，
 * 也管教学质量优秀这类**名额**，核心作用是「这次派了谁、下次该轮到谁」。
 * 「值班」只是它下面的一个类型，拿来当模块名会把名额那半边排除在外。
 * 路由和模型名不跟着改（数据库英文、界面中文，见代码约定）。
 */
export const ROUTINE_TABS: Array<{ href: string; label: string; icon: LucideIcon }> = [
  { href: "/tasks", label: "任务", icon: ListTodo },
  { href: "/meetings", label: "会议", icon: Users },
  { href: "/duties", label: "轮派", icon: Repeat },
  { href: "/calendar", label: "日历", icon: CalendarDays },
];

/** 二级 tab 同样按模块开关过滤——「轮派」是可选模块（lib/modules.ts） */
export function routineTabsFor(modules: ModuleVisibility): typeof ROUTINE_TABS {
  return ROUTINE_TABS.filter((tab) => {
    const key = moduleForPath(tab.href);
    return key == null || modules[key];
  });
}

/**
 * 「成果」下面的二级导航。
 *
 * 「待核实」带的两个参数都不能省：
 *   `unverified=1` 是这个视图本身；
 *   `scope=all` 是因为台账**默认只看职称口径**，而未核实的记录里大半还没挂
 *   职称指标——不切成全部口径，点进「待核实」会看到一个几乎空的列表，
 *   而问题恰恰是那些还没归类的记录。
 */
export const ACHIEVEMENT_TABS: Array<{ href: string; label: string }> = [
  { href: "/achievements", label: "台账" },
  { href: "/achievements?scope=all&unverified=1", label: "待核实" },
  { href: "/export", label: "导出" },
];

/**
 * 「班主任」下面的二级导航。**这里的 URL 刻意嵌套**，与「日常」的扁平
 * 路由不冲突：日常那四个是彼此独立的功能，班主任这四个是同一个域共享
 * 同一个班级上下文的视图，/students 是它们唯一的家。
 */
export const STUDENT_TABS: Array<{ href: string; label: string }> = [
  { href: "/students", label: "名册" },
  { href: "/students/checklists", label: "勾名单" },
  { href: "/students/honors", label: "荣誉" },
  { href: "/students/records", label: "记录" },
];

/** 班主任域二级导航的高亮。学生详情（/students/<id>）归「名册」 */
export function activeStudentTab(pathname: string): string | null {
  for (const tab of STUDENT_TABS) {
    if (tab.href === "/students") continue;
    if (pathname === tab.href || pathname.startsWith(`${tab.href}/`)) return tab.href;
  }
  if (pathname === "/students" || pathname.startsWith("/students/")) return "/students";
  return null;
}

/** 这个路径归哪个一级导航项管，用于高亮 */
export function activeNavHref(pathname: string): string | null {
  for (const item of NAV_ITEMS) {
    if (item.href === "/") {
      if (pathname === "/") return "/";
      continue;
    }
    const paths = item.covers ?? [item.href];
    if (paths.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
      return item.href;
    }
  }
  return null;
}

/**
 * 成果域二级导航的高亮。**光比 pathname 不够**——「台账」和「待核实」
 * 是同一个路径，区别只在 `unverified` 这个查询参数上。
 */
export function activeAchievementTab(
  pathname: string,
  unverified: string | null,
): string | null {
  if (pathname === "/export" || pathname.startsWith("/export/")) return "/export";
  if (pathname !== "/achievements") return null;
  return unverified === "1" ? "/achievements?scope=all&unverified=1" : "/achievements";
}
