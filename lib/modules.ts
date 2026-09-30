/**
 * 可选功能模块的注册表（唯一来源）。
 *
 * 背景：本平台开源后，别的老师未必带班、未必管轮派、未必用配套的备课系统。
 * 设置页提供勾选，导航、二级 tab、搜索、路由守卫全从这一份注册表读——
 * 两处各存一份名单，早晚出现「导航上没有、搜索却搜得到」的裂缝
 * （同 lib/requirement-types.ts 的教训）。
 *
 * 三条语义约定：
 * - **关闭 = 隐藏，不 = 删除，也不 = 封锁。** 数据一个字节不动，重新勾上一切
 *   回来；直接访问被关模块的 URL 显示「未启用」提示而不是 403——用户才敢随便试。
 * - **平台骨架不进注册表**：首页、任务、会议、日历、科研、成果是本体，不可关。
 * - 「五个一级入口是上限」在开关时代改写成**「同时启用的一级入口不超过 N 个」**，
 *   超出给软提示（提示，不阻止——校验永远不阻止保存的老规矩）。
 *   **阈值只写在 app/(app)/settings/modules-panel.tsx 一处**，别在这里也写一个数字：
 *   这行注释以前写着「不超过 5 个」，而实际阈值早已是 6，两个数字对不上了大半年。
 *
 * 本文件必须保持客户端可引用（SideNav 是客户端组件）：
 * 不 import prisma、不加 server-only。读数据库的部分在 lib/module-settings.ts。
 */

export type ModuleKey =
  | "teaching"
  | "duties"
  | "advisor"
  | "competitions"
  | "mentor";

export type ModuleDef = {
  key: ModuleKey;
  /** 设置页勾选框的名字，与导航用词一致 */
  label: string;
  /** 设置页的一句话说明：这个模块管什么、关掉少什么 */
  description: string;
  /**
   * 该模块独占的路径前缀。用于路由守卫（未启用时显示提示页）
   * 和 moduleForPath 的归属判断。
   */
  routes: string[];
  defaultEnabled: boolean;
};

export const MODULES: readonly ModuleDef[] = [
  {
    key: "teaching",
    label: "教学",
    description:
      "备课系统外联与教案回流。不用独立部署的备课系统就用不上，可以关掉。",
    routes: ["/teaching"],
    defaultEnabled: true,
  },
  {
    key: "duties",
    label: "轮派",
    description:
      "监考、校级会议这类活和教学质量优秀这类名额的轮流分派记录，不管分派就关掉。",
    routes: ["/duties"],
    defaultEnabled: true,
  },
  {
    key: "competitions",
    label: "参赛",
    description:
      "指导学生参赛：赛事字典、历年参赛记录、报名截止倒计时、获奖证书。不带队参赛就关掉。",
    routes: ["/competitions"],
    defaultEnabled: true,
  },
  {
    key: "advisor",
    label: "班主任",
    description:
      "班级名册、勾名单收缴、学生荣誉、谈话记录。带班才用得上，默认关闭。",
    routes: ["/students"],
    // 这个模块是给带班老师准备的，不带班就一直关着
    defaultEnabled: false,
  },
  {
    // **和上面那个不是一回事。** advisor = 班主任（一个班的日常事务），
    // mentor = 学业导师（双选分来的一批学生，从低年级带到毕业 + 毕设指导）。
    // 英文 advisor 本义就是「导师」，两个词在中文里都像「导师」——
    // 但它们是两个模块、两套表、两个开关，路由也刻意岔开（/students 与 /mentees）。
    key: "mentor",
    label: "导师",
    description:
      "学业导师带的学生：名单、指导记录、毕设与作品。不带导师学生就关掉。",
    routes: ["/mentees"],
    // 同班主任：不是每个老师都带导师学生，默认关着
    defaultEnabled: false,
  },
] as const;

/** 各模块的启用状态。键集与 MODULES 一致，由 lib/module-settings.ts 生成 */
export type ModuleVisibility = Record<ModuleKey, boolean>;

/** 全部按默认值。测试和降级路径用；正常渲染一律走 getEnabledModules() */
export const DEFAULT_MODULE_VISIBILITY: ModuleVisibility = Object.fromEntries(
  MODULES.map((module) => [module.key, module.defaultEnabled]),
) as ModuleVisibility;

/** 这个路径属于哪个可选模块。null = 平台骨架，永远可见 */
export function moduleForPath(pathname: string): ModuleKey | null {
  for (const mod of MODULES) {
    if (
      mod.routes.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`),
      )
    ) {
      return mod.key;
    }
  }
  return null;
}

export function moduleLabel(key: ModuleKey): string {
  const found = MODULES.find((module) => module.key === key);
  // 注册表键集是闭合的，走不到这里；兜底只为类型完整
  return found?.label ?? key;
}
