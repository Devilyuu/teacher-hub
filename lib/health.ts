export type HealthStatus = { ok: true } | { ok: false };

/**
 * 健康检查只暴露可用性，不返回数据库地址、异常消息或表数量。
 * 详细错误留在容器日志中，公网端点统一回答 503。
 */
export async function getHealthStatus(
  pingDatabase: () => Promise<unknown>,
): Promise<HealthStatus> {
  try {
    await pingDatabase();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
