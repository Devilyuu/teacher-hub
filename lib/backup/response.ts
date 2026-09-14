/**
 * 备份下载响应的判定（增量 3.8）。
 *
 * 抽成纯函数是为了能单测——这里判错的后果特别隐蔽：
 * **用户会下载到一个名为 `.json` 的 HTML 登录页，并且以为备份成功了。**
 */

type ResponseShape = {
  /** fetch 的 `Response.type`，`redirect: "manual"` 下跨过重定向时是 `opaqueredirect` */
  type: string;
  status: number;
};

/**
 * 会话失效被 `proxy.ts` 挡下的重定向。
 *
 * **这是本功能唯一会静默出错的地方。** proxy 对未登录请求一律
 * `NextResponse.redirect` 到 `/login`，包括 `/api/*`——它不返回 401。
 * 而 fetch 默认 `redirect: "follow"` 会跟着跳过去、拿回登录页的 HTML 并且
 * `response.ok === true`。不拦这一下，会话一过期，下载下来的就是一个
 * 后缀是 .json 的登录页面，用户毫不知情。
 */
export function isSessionRedirect(response: ResponseShape): boolean {
  // `redirect: "manual"` 下同源重定向会得到 type=opaqueredirect、status=0
  if (response.type === "opaqueredirect") return true;
  if (response.status === 0) return true;
  return response.status >= 300 && response.status < 400;
}

/** 真正的备份负载必须是 JSON */
export function isBackupPayload(contentType: string | null): boolean {
  return (contentType ?? "").toLowerCase().includes("application/json");
}
