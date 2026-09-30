import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  MODULES,
  type ModuleKey,
  type ModuleVisibility,
} from "@/lib/modules";

/**
 * 读出各模块的启用状态：库里有行按行、没有行按注册表默认值。
 *
 * 每次请求查一次库，**同一请求内去重**（React `cache`）。布局、首页、
 * 搜索、月历、各模块守卫都要问一遍开关，原来一个请求查两三次。
 * `cache` 只活在单个请求里，不会做出「设置里勾了、导航没变」那种幽灵故障——
 * 保存开关的 Action 自己不读这个函数，重渲染时缓存是冷的。
 */
export const getEnabledModules = cache(getEnabledModulesUncached);

async function getEnabledModulesUncached(): Promise<ModuleVisibility> {
  const rows = await prisma.moduleSetting.findMany({
    select: { key: true, enabled: true },
  });
  const stored = new Map(rows.map((row) => [row.key, row.enabled]));
  return Object.fromEntries(
    MODULES.map((module) => [
      module.key,
      stored.get(module.key) ?? module.defaultEnabled,
    ]),
  ) as ModuleVisibility;
}

/** 单个模块开没开。路由守卫用 */
export async function isModuleEnabled(key: ModuleKey): Promise<boolean> {
  const modules = await getEnabledModules();
  return modules[key];
}
