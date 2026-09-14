/**
 * 启动自检。Next.js 会在服务端启动时调用一次 `register()`。
 *
 * 现在只查一件事：**进程时区**。
 *
 * 全平台只有这一套时区假设——进程时区 = 用户所在时区。`lib/date.ts` 的
 * `todayAsDateOnly()` 按进程本地时区判断「今天是几号」，容器里若留了默认的 UTC，
 * 东八区每天 00:00–08:00 之间「今天」会算成昨天：倒计时少一天、没逾期的任务标成
 * 逾期、周期任务生成到错误的日子上。
 *
 * 这类错误不会抛异常、不会让页面出错，只是所有日期悄悄差一天——
 * 除非有人恰好在早上八点前对着日历核对，否则能瞒很久。所以把它摆到启动日志第一行，
 * 部署完 `docker compose logs app` 一眼能看见。
 */
export function register() {
  // 只在 Node 运行时报一次，免得 edge 运行时再打一遍
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offsetHours = -new Date().getTimezoneOffset() / 60;

  if (offsetHours === 8) {
    console.log(`[启动] 进程时区 ${timeZone}（UTC+8），日期口径正常`);
    return;
  }

  console.warn(
    `[启动] 进程时区是 ${timeZone}（UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}），` +
      `不是东八区——倒计时、逾期判定、周期任务生成都会差一天。` +
      `请在环境变量里设置 TZ=Asia/Shanghai（见 docs/deploy.md 第 6 节）`,
  );
}
