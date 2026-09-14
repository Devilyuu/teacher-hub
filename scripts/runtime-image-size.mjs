import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { createGzip } from "node:zlib";

const DEFAULT_TERMINATE_GRACE_MS = 2_000;
const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_MEASUREMENT_DEADLINE_MS = 120_000;
const MAX_STDERR_BYTES = 64 * 1024;

export class RuntimeImageMeasurementError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "RuntimeImageMeasurementError";
    this.code = code;
    Object.assign(this, details);
  }
}

function captureBoundedStderr(stream) {
  const chunks = [];
  let bytes = 0;

  stream?.on("data", (chunk) => {
    if (bytes >= MAX_STDERR_BYTES) return;
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const slice = buffer.subarray(0, MAX_STDERR_BYTES - bytes);
    chunks.push(slice);
    bytes += slice.byteLength;
  });

  return () => Buffer.concat(chunks).toString("utf8").trim();
}

async function settlesWithin(promise, timeoutMs) {
  let timer;
  const timedOut = new Promise((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([promise.then(() => true), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function terminateAndReap(
  child,
  closedPromise,
  isClosed,
  terminateGraceMs,
  killGraceMs,
) {
  if (isClosed() || !child.pid) return true;

  try {
    child.kill("SIGTERM");
  } catch {
    // Continue to the SIGKILL fallback; the original measurement failure wins.
  }
  if (await settlesWithin(closedPromise, terminateGraceMs)) return true;

  try {
    child.kill("SIGKILL");
  } catch {
    // The bounded wait below still determines whether the process was reaped.
  }
  return settlesWithin(closedPromise, killGraceMs);
}

function createDeadline(deadlineMs) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new RuntimeImageMeasurementError(
          "DEADLINE_EXCEEDED",
          `docker image save 压缩计量超过整体时限 ${deadlineMs}ms`,
          { deadlineMs },
        ),
      );
    }, deadlineMs);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

async function cleanupFailure({
  originalFailure,
  child,
  closedPromise,
  isClosed,
  streams,
  terminateGraceMs,
  killGraceMs,
}) {
  for (const stream of streams) stream?.destroy();
  const reaped = await terminateAndReap(
    child,
    closedPromise,
    isClosed,
    terminateGraceMs,
    killGraceMs,
  );
  if (reaped) return originalFailure;

  return new RuntimeImageMeasurementError(
    "REAP_TIMEOUT",
    `docker image save 在 SIGTERM ${terminateGraceMs}ms 与 SIGKILL ${killGraceMs}ms 后仍未 close；原始失败：${originalFailure.code ?? originalFailure.name}`,
    {
      originalCode: originalFailure.code ?? "UNKNOWN_FAILURE",
      originalFailure,
      terminateGraceMs,
      killGraceMs,
    },
  );
}

function normalizeFailure(error, { limitFailure, processError, stdoutError, gzipError }) {
  if (limitFailure) return limitFailure;
  if (error instanceof RuntimeImageMeasurementError) return error;
  if (stdoutError) {
    return new RuntimeImageMeasurementError(
      "SAVE_STREAM_ERROR",
      `读取 docker image save 输出失败：${stdoutError.message}`,
      { cause: stdoutError },
    );
  }
  if (gzipError) {
    return new RuntimeImageMeasurementError(
      "COMPRESS_STREAM_ERROR",
      `压缩 docker image save 输出失败：${gzipError.message}`,
      { cause: gzipError },
    );
  }
  if (processError) return processError;
  return new RuntimeImageMeasurementError(
    "COMPRESS_STREAM_ERROR",
    `计算镜像压缩分发体积失败：${error instanceof Error ? error.message : String(error)}`,
    { cause: error instanceof Error ? error : undefined },
  );
}

export async function measureCompressedDistributionSize({
  image,
  maxBytes,
  spawnImpl = spawn,
  createGzipImpl = createGzip,
  deadlineMs = DEFAULT_MEASUREMENT_DEADLINE_MS,
  terminateGraceMs = DEFAULT_TERMINATE_GRACE_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
}) {
  let child;
  try {
    child = spawnImpl("docker", ["image", "save", image], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (cause) {
    throw new RuntimeImageMeasurementError(
      "SPAWN_FAILED",
      `无法启动 docker image save：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
  }

  if (!child?.stdout || !child?.stderr) {
    throw new RuntimeImageMeasurementError(
      "SPAWN_FAILED",
      "docker image save 未提供可读取的输出流",
    );
  }

  const readStderr = captureBoundedStderr(child.stderr);
  let closed = false;
  let stdoutError;
  let gzipError;
  let processError;
  let limitFailure;

  const closedPromise = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      closed = true;
      resolve({ code, signal });
    });
  });
  const processPromise = new Promise((resolve, reject) => {
    child.once("error", (cause) => {
      processError = new RuntimeImageMeasurementError(
        "SPAWN_FAILED",
        `docker image save 启动失败：${cause.message}`,
        { cause },
      );
      reject(processError);
    });
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      processError = new RuntimeImageMeasurementError(
        "SAVE_EXIT",
        `docker image save 非正常退出（code=${code ?? "null"}, signal=${signal ?? "none"}）`,
        { exitCode: code, signal, stderr: readStderr() },
      );
      reject(processError);
    });
  });

  child.stdout.once("error", (error) => {
    stdoutError = error;
  });

  const sourceCounter = new Transform({
    transform(chunk, _encoding, callback) {
      this.sourceBytes = (this.sourceBytes ?? 0) + chunk.byteLength;
      callback(null, chunk);
    },
  });
  sourceCounter.sourceBytes = 0;
  let gzip;
  try {
    gzip = createGzipImpl();
  } catch (cause) {
    processPromise.catch(() => {});
    const originalFailure = new RuntimeImageMeasurementError(
      "COMPRESS_STREAM_ERROR",
      `无法创建镜像压缩流：${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: cause instanceof Error ? cause : undefined },
    );
    throw await cleanupFailure({
      originalFailure,
      child,
      closedPromise,
      isClosed: () => closed,
      streams: [child.stdout, child.stderr, sourceCounter],
      terminateGraceMs,
      killGraceMs,
    });
  }
  gzip.once("error", (error) => {
    gzipError = error;
  });

  const pipelinePromise = pipeline(child.stdout, sourceCounter, gzip);
  const compressedPromise = (async () => {
    let compressedBytes = 0;
    for await (const chunk of gzip) {
      compressedBytes += chunk.byteLength;
      if (compressedBytes > maxBytes) {
        limitFailure = new RuntimeImageMeasurementError(
          "LIMIT_EXCEEDED",
          `运行镜像压缩分发体积超过上限：${compressedBytes} > ${maxBytes} bytes`,
          { compressedBytes, maxBytes },
        );
        throw limitFailure;
      }
    }
    return compressedBytes;
  })();

  const deadline = createDeadline(deadlineMs);
  try {
    const [, , compressedBytes] = await Promise.race([
      Promise.all([
        processPromise,
        pipelinePromise,
        compressedPromise,
      ]),
      deadline.promise,
    ]);
    if (sourceCounter.sourceBytes === 0) {
      throw new RuntimeImageMeasurementError(
        "EMPTY_OUTPUT",
        "docker image save 没有输出任何镜像数据",
      );
    }
    return { compressedBytes, sourceBytes: sourceCounter.sourceBytes };
  } catch (error) {
    const originalFailure = normalizeFailure(error, {
      limitFailure,
      processError,
      stdoutError,
      gzipError,
    });
    throw await cleanupFailure({
      originalFailure,
      child,
      closedPromise,
      isClosed: () => closed,
      streams: [child.stdout, child.stderr, sourceCounter, gzip],
      terminateGraceMs,
      killGraceMs,
    });
  } finally {
    deadline.cancel();
  }
}
