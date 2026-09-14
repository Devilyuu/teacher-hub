import { describe, expect, it } from "vitest";
import {
  DEFAULT_MODULE_VISIBILITY,
  MODULES,
  moduleForPath,
  type ModuleVisibility,
} from "./modules";
import {
  ACHIEVEMENT_TABS,
  NAV_ITEMS,
  ROUTINE_TABS,
  activeAchievementTab,
  activeNavHref,
  mobileTabsFor,
  navItemsFor,
  routineTabsFor,
} from "./nav";

const ALL_ON = Object.fromEntries(
  MODULES.map((module) => [module.key, true]),
) as ModuleVisibility;
const ALL_OFF = Object.fromEntries(
  MODULES.map((module) => [module.key, false]),
) as ModuleVisibility;

describe("NAV_ITEMS", () => {
  it("全集是首页/日常/科研/教学/参赛/班主任/成果七项，顺序固定", () => {
    expect(NAV_ITEMS.map((item) => item.label)).toEqual([
      "首页",
      "日常",
      "科研",
      "教学",
      "参赛",
      "班主任",
      "成果",
    ]);
  });

  it("默认开关下渲染出六项——班主任默认关闭", () => {
    expect(navItemsFor(DEFAULT_MODULE_VISIBILITY).map((item) => item.label)).toEqual([
      "首页",
      "日常",
      "科研",
      "教学",
      "参赛",
      "成果",
    ]);
  });

  it("一级入口上限 = 默认可见不超过 6 项；全开也就 7 项", () => {
    // 2026-09-12 加「参赛」时从 5 抬到 6（理由记在 lib/nav.ts 的注释里）。
    // 这条断言的作用不是挡住第 7 项，是**让抬上限这件事必须改测试**——
    // 顺手多塞一项而没人注意到，才是导航变成抽屉的方式
    expect(navItemsFor(DEFAULT_MODULE_VISIBILITY).length).toBeLessThanOrEqual(6);
    expect(navItemsFor(ALL_ON).length).toBeLessThanOrEqual(7);
  });

  it("骨架项不受开关影响——全关也剩首页/日常/科研/成果", () => {
    expect(navItemsFor(ALL_OFF).map((item) => item.label)).toEqual([
      "首页",
      "日常",
      "科研",
      "成果",
    ]);
  });

  it("不再有指向素材占位页的入口", () => {
    const targets = NAV_ITEMS.flatMap((item) => [item.href, ...(item.covers ?? [])]);
    expect(targets).not.toContain("/materials");
  });

  it("每个一级入口都有实际页面（没有只存在于导航里的路径）", () => {
    // 这几条路径在 app/(app)/ 下都有对应目录。旧结构的教训：
    // 「更多」指向一个未实现的占位页，用户点进去是空的
    expect(NAV_ITEMS.map((item) => item.href)).toEqual([
      "/",
      "/tasks",
      "/projects",
      "/teaching",
      "/competitions",
      "/students",
      "/achievements",
    ]);
  });
});

describe("mobileTabsFor（手机底部导航）", () => {
  it("参赛开着是五项：首页/日常/科研/参赛/成果，顺序跟全集一致", () => {
    expect(mobileTabsFor(ALL_ON).map((item) => item.label)).toEqual([
      "首页",
      "日常",
      "科研",
      "参赛",
      "成果",
    ]);
  });

  it("参赛关掉就剩四项骨架——底栏也跟模块开关走", () => {
    expect(mobileTabsFor(ALL_OFF).map((item) => item.label)).toEqual([
      "首页",
      "日常",
      "科研",
      "成果",
    ]);
  });

  it("教学和班主任开着也不进底栏——五项是手机底栏的上限", () => {
    const labels = mobileTabsFor(ALL_ON).map((item) => item.label);
    expect(labels).not.toContain("教学");
    expect(labels).not.toContain("班主任");
    expect(labels.length).toBeLessThanOrEqual(5);
  });

  it("是一级导航的子集，不另起一份名单", () => {
    const full = new Set(navItemsFor(ALL_ON));
    for (const item of mobileTabsFor(ALL_ON)) expect(full.has(item)).toBe(true);
  });
});

describe("MODULES 注册表", () => {
  it("键唯一、路由不重叠", () => {
    const keys = MODULES.map((module) => module.key);
    expect(new Set(keys).size).toBe(keys.length);
    const routes = MODULES.flatMap((module) => module.routes);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("每个模块的路由都能从导航或二级 tab 到达——注册了却没有入口等于没做", () => {
    const reachable = new Set([
      ...NAV_ITEMS.map((item) => item.href),
      ...ROUTINE_TABS.map((tab) => tab.href),
    ]);
    for (const mod of MODULES) {
      expect(
        mod.routes.some((route) => reachable.has(route)),
        `${mod.key} 的路由 ${mod.routes.join("、")} 没有任何导航入口`,
      ).toBe(true);
    }
  });

  it("moduleForPath 与注册表互相咬合，子路径也归属正确", () => {
    for (const mod of MODULES) {
      for (const route of mod.routes) {
        expect(moduleForPath(route)).toBe(mod.key);
        expect(moduleForPath(`${route}/abc`)).toBe(mod.key);
      }
    }
    // 骨架路径不属于任何可选模块
    for (const path of ["/", "/tasks", "/projects", "/achievements", "/settings"]) {
      expect(moduleForPath(path), path).toBeNull();
    }
  });

  it("模块开关表单的键集从注册表派生——加模块不用改 schema", async () => {
    const { moduleSettingsSchema } = await import("./schemas/modules");
    expect(Object.keys(moduleSettingsSchema.shape).sort()).toEqual(
      MODULES.map((module) => module.key).sort(),
    );
  });

  it("轮派 tab 跟着开关走，其余三个雷打不动", () => {
    expect(routineTabsFor(DEFAULT_MODULE_VISIBILITY).map((tab) => tab.label)).toEqual([
      "任务",
      "会议",
      "轮派",
      "日历",
    ]);
    expect(routineTabsFor(ALL_OFF).map((tab) => tab.label)).toEqual([
      "任务",
      "会议",
      "日历",
    ]);
  });
});

describe("activeNavHref", () => {
  it("首页只在精确匹配时点亮，不吃掉所有路径", () => {
    expect(activeNavHref("/")).toBe("/");
    expect(activeNavHref("/projects")).toBe("/projects");
  });

  it("日常那四个扁平路由都点亮「日常」", () => {
    for (const { href } of ROUTINE_TABS) {
      expect(activeNavHref(href), href).toBe("/tasks");
    }
    expect(activeNavHref("/meetings/abc")).toBe("/tasks");
  });

  it("导出点亮「成果」——它是成果域的二级页，不是独立模块", () => {
    expect(activeNavHref("/export")).toBe("/achievements");
    expect(activeNavHref("/achievements/abc")).toBe("/achievements");
  });

  it("教学是独立一级", () => {
    expect(activeNavHref("/teaching")).toBe("/teaching");
  });

  it("设置和档案不点亮任何一级导航——它们是顶栏工具，不占一级位置", () => {
    expect(activeNavHref("/settings")).toBeNull();
    expect(activeNavHref("/profile")).toBeNull();
    expect(activeNavHref("/search")).toBeNull();
  });
});

describe("ACHIEVEMENT_TABS", () => {
  it("待核实必须同时带 scope=all——台账默认只看职称口径", () => {
    const unverified = ACHIEVEMENT_TABS.find((tab) => tab.label === "待核实");
    expect(unverified?.href).toContain("unverified=1");
    // 少了这个参数，点进「待核实」会看到几乎空的列表，
    // 而未核实的记录里大半恰恰是还没挂职称指标的那些
    expect(unverified?.href).toContain("scope=all");
  });
});

describe("activeAchievementTab", () => {
  it("台账与待核实是同一个路径，靠查询参数区分", () => {
    expect(activeAchievementTab("/achievements", null)).toBe("/achievements");
    expect(activeAchievementTab("/achievements", "1")).toBe(
      "/achievements?scope=all&unverified=1",
    );
  });

  it("导出页点亮导出", () => {
    expect(activeAchievementTab("/export", null)).toBe("/export");
  });

  it("成果详情页不点亮任何 tab——它不属于这三个视图里的哪一个", () => {
    expect(activeAchievementTab("/achievements/abc", null)).toBeNull();
    expect(activeAchievementTab("/achievements/new", null)).toBeNull();
  });
});
