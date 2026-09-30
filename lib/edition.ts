/**
 * 部署形态：服务器版（Docker，默认）还是桌面版（desktop/，Electron 壳 + 内置数据库）。
 *
 * 两者是**同一份网页代码的两种部署**（CLAUDE.md「桌面版」）。桌面壳起网页服务时设
 * `TEACHER_DESK_EDITION=desktop`；这个开关只用来换文案、藏掉桌面版上走不通的入口
 * （服务器 cron、环境变量名、备课系统外联），**不许拿它改业务口径**——那就成了分叉。
 */
type Env = Record<string, string | undefined>;

export function isDesktopEdition(env: Env = process.env): boolean {
  return env.TEACHER_DESK_EDITION === "desktop";
}

/**
 * 桌面壳给自己的窗口在 User-Agent 末尾加的记号（desktop/src/main.ts 里有同名常量，
 * lib/desktop-contract.test.ts 对拍）。手机经「手机访问」进来不带它。
 *
 * 只用来决定「这个请求来自电脑上的窗口」这种**界面**问题，比如窗口里不放「退出」——
 * UA 谁都能改，所以绝不能拿它做鉴权。
 */
export const DESKTOP_WINDOW_UA_TOKEN = "TeacherDeskWindow";

export function isDesktopWindow(userAgent: string | null | undefined, env: Env = process.env): boolean {
  return isDesktopEdition(env) && (userAgent ?? "").includes(DESKTOP_WINDOW_UA_TOKEN);
}
