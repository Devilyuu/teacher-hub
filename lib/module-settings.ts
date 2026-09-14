import "server-only";
import { prisma } from "@/lib/db";
import {
  MODULES,
  type ModuleKey,
  type ModuleVisibility,
} from "@/lib/modules";

/**
 * 读出各模块的启用状态：库里有行按行、没有行按注册表默认值。
 *
 * 每次请求都查一次库。(app) 布局本来就是 force-dynamic、全组页面每请求
 * 渲染，这张表最多三行，不值得为它上缓存——缓存失效反而会做出
 * 「设置里勾了、导航没变」这种幽灵故障。
 */
export async function getEnabledModules(): Promise<ModuleVisibility> {
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
