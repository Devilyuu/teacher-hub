import { spawnSync } from "node:child_process";

const DEFAULT_PROBE_TIMEOUT_MS = 30_000;

export class RuntimeImageProbeError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "RuntimeImageProbeError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function probeRuntimeImageContents({
  image,
  timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
  spawnSyncImpl = spawnSync,
}) {
  let result;
  try {
    result = spawnSyncImpl(
      "docker",
      [
        "run",
        "--rm",
        "--entrypoint",
        "sh",
        image,
        "-c",
        [
          "for p in",
          "/app/.env /app/docs /app/data/postgres /app/data/caddy",
          "/app/app /app/lib /app/test;",
          'do [ ! -e "$p" ] || { echo "UNEXPECTED_RUNTIME_PATH:$p"; exit 1; }; done;',
          '[ -d /var/lib/teacher-desk-audio ] || { echo "MISSING_RUNTIME_AUDIO_ROOT"; exit 1; };',
          '[ -z "$(find /var/lib/teacher-desk-audio -mindepth 1 -print -quit)" ] ||',
          '{ echo "UNEXPECTED_RUNTIME_AUDIO_CONTENT"; exit 1; }',
        ].join(" "),
      ],
      {
        encoding: "utf8",
        timeout: timeoutMs,
        killSignal: "SIGKILL",
      },
    );
  } catch (cause) {
    throw new RuntimeImageProbeError(
      "PROBE_SPAWN_FAILED",
      `无法启动运行镜像内容探针：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  if (result.error?.code === "ETIMEDOUT") {
    throw new RuntimeImageProbeError(
      "PROBE_TIMEOUT",
      `运行镜像内容探针超过 ${timeoutMs}ms，已发送 SIGKILL`,
      { timeoutMs, signal: result.signal, exitCode: 124, cause: result.error },
    );
  }
  if (result.error) {
    throw new RuntimeImageProbeError(
      "PROBE_SPAWN_FAILED",
      `运行镜像内容探针启动失败：${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0) {
    throw new RuntimeImageProbeError(
      "PROBE_EXIT",
      `运行镜像内容探针非正常退出（code=${result.status ?? "null"}, signal=${result.signal ?? "none"}）`,
      {
        exitCode: result.status,
        signal: result.signal,
        stdout: result.stdout?.trim() ?? "",
        stderr: result.stderr?.trim() ?? "",
      },
    );
  }
}
