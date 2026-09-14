import { EventEmitter } from "node:events";
import { PassThrough, Transform } from "node:stream";
import { gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import {
  RuntimeImageMeasurementError,
  measureCompressedDistributionSize,
} from "./runtime-image-size.mjs";

function fakeDockerSave({
  chunks = [],
  exitCode = 0,
  stderr = "",
  stdoutError,
  autoClose = true,
  closeOnSignals = ["SIGTERM", "SIGKILL"],
} = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.pid = 4242;
  child.backpressureCount = 0;
  child.kill = vi.fn((signal = "SIGTERM") => {
    child.signalCode = signal;
    if (closeOnSignals.includes(signal)) {
      child.stdout.destroy();
      child.stderr.destroy();
      queueMicrotask(() => child.emit("close", null, signal));
    }
    return true;
  });

  const waitForDrainOrClose = () =>
    new Promise((resolve) => {
      const finish = () => {
        child.stdout.off("drain", finish);
        child.stdout.off("close", finish);
        child.stdout.off("error", finish);
        resolve();
      };
      child.stdout.once("drain", finish);
      child.stdout.once("close", finish);
      child.stdout.once("error", finish);
    });

  child.pumpPromise = (async () => {
    await Promise.resolve();
    if (stderr) child.stderr.end(stderr);
    else child.stderr.end();
    for (const chunk of chunks) {
      if (child.stdout.destroyed) return;
      if (!child.stdout.write(chunk)) {
        child.backpressureCount += 1;
        await waitForDrainOrClose();
      }
    }
    if (stdoutError) {
      child.stdout.destroy(stdoutError);
      return;
    }
    child.stdout.end();
    if (!autoClose) return;
    child.exitCode = exitCode;
    child.emit("close", exitCode, null);
  })();

  return child;
}

function spawnFor(options, observer = {}) {
  return vi.fn(() => {
    const child = fakeDockerSave(options);
    observer.child = child;
    return child;
  });
}

async function expectMeasurementError(promise, code) {
  await expect(settleTestPromise(promise)).rejects.toMatchObject({
    name: "RuntimeImageMeasurementError",
    code,
  });
}

async function settleTestPromise(promise, timeoutMs = 1_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`TEST_SETTLE_TIMEOUT:${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function measure(options, testTimeoutMs) {
  return settleTestPromise(measureCompressedDistributionSize(options), testTimeoutMs);
}

describe("compressed runtime-image distribution size", () => {
  it("accepts compressed output below the threshold", async () => {
    const source = Buffer.from("classic-layer".repeat(256));
    const expected = gzipSync(source).byteLength;
    const spawnImpl = spawnFor({ chunks: [source] });

    const result = await measure({
      image: "test:image",
      maxBytes: expected + 1,
      spawnImpl,
    });

    expect(result).toEqual({ compressedBytes: expected, sourceBytes: source.byteLength });
    expect(spawnImpl).toHaveBeenCalledWith(
      "docker",
      ["image", "save", "test:image"],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
  });

  it("accepts compressed output exactly equal to the threshold", async () => {
    const source = Buffer.from("equal-threshold".repeat(64));
    const expected = gzipSync(source).byteLength;

    const result = await measure({
      image: "test:image",
      maxBytes: expected,
      spawnImpl: spawnFor({ chunks: [source.subarray(0, 17), source.subarray(17)] }),
    });

    expect(result.compressedBytes).toBe(expected);
  });

  it("rejects output over the threshold and reaps docker save", async () => {
    const observer = {};
    const source = Buffer.from("over-threshold".repeat(64));
    const expected = gzipSync(source).byteLength;

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: expected - 1,
        spawnImpl: spawnFor({ chunks: [source], autoClose: false }, observer),
        terminateGraceMs: 10,
      }),
      "LIMIT_EXCEEDED",
    );
    expect(observer.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(observer.child.signalCode).toBe("SIGTERM");
  });

  it("rejects an empty docker save stream even though gzip has framing bytes", async () => {
    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: spawnFor(),
      }),
      "EMPTY_OUTPUT",
    );
  });

  it("propagates a non-zero docker save exit with bounded stderr", async () => {
    await expect(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: spawnFor({
          chunks: [Buffer.from("partial")],
          exitCode: 17,
          stderr: "save failed",
        }),
      }),
    ).rejects.toMatchObject({ code: "SAVE_EXIT", exitCode: 17, stderr: "save failed" });
  });

  it("propagates docker save stdout errors and reaps the child", async () => {
    const observer = {};
    const streamError = new Error("stdout broke");

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: spawnFor({ stdoutError: streamError, autoClose: false }, observer),
        terminateGraceMs: 10,
      }),
      "SAVE_STREAM_ERROR",
    );
    expect(observer.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("propagates compression-stream errors and reaps the child", async () => {
    const observer = {};
    const brokenCompressor = () =>
      new Transform({
        transform(_chunk, _encoding, callback) {
          callback(new Error("compressor broke"));
        },
      });

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: spawnFor(
          { chunks: [Buffer.from("data")], autoClose: false },
          observer,
        ),
        createGzipImpl: brokenCompressor,
        terminateGraceMs: 10,
      }),
      "COMPRESS_STREAM_ERROR",
    );
    expect(observer.child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("reaps docker save when the compression stream cannot be created", async () => {
    const observer = {};

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: spawnFor({ chunks: [Buffer.from("data")], autoClose: false }, observer),
        createGzipImpl: () => {
          throw new Error("gzip unavailable");
        },
        terminateGraceMs: 10,
      }),
      "COMPRESS_STREAM_ERROR",
    );
    expect(observer.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(observer.child.stderr.destroyed).toBe(true);
  });

  it("measures already-compressed input after a second gzip pass", async () => {
    const alreadyCompressedInput = gzipSync(Buffer.from("layer-content".repeat(1024)));
    const expected = gzipSync(alreadyCompressedInput).byteLength;

    const result = await measure({
      image: "test:image",
      maxBytes: expected,
      spawnImpl: spawnFor({ chunks: [alreadyCompressedInput] }),
    });

    expect(result.compressedBytes).toBe(expected);
    expect(result.sourceBytes).toBe(alreadyCompressedInput.byteLength);
  });

  it("measures highly compressible input by its gzip output size", async () => {
    const compressibleInput = Buffer.alloc(128 * 1024, 0x61);
    const expected = gzipSync(compressibleInput).byteLength;

    const result = await measure({
      image: "test:image",
      maxBytes: expected,
      spawnImpl: spawnFor({ chunks: [compressibleInput] }),
    });

    expect(result.compressedBytes).toBe(expected);
    expect(result.compressedBytes).toBeLessThan(result.sourceBytes / 100);
  });

  it("propagates synchronous docker save startup failures", async () => {
    const cause = new Error("spawn failed");

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: () => {
          throw cause;
        },
      }),
      "SPAWN_FAILED",
    );
  });

  it("propagates emitted startup failures and closes unused stdio", async () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.pid = undefined;
    child.kill = vi.fn();
    queueMicrotask(() => child.emit("error", new Error("docker missing")));

    await expectMeasurementError(
      measure({
        image: "test:image",
        maxBytes: 1024,
        spawnImpl: () => child,
      }),
      "SPAWN_FAILED",
    );
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("settles within bounded cleanup time when overall deadline expires and close never arrives", async () => {
    const observer = {};

    await expect(
      measure(
        {
          image: "test:image",
          maxBytes: 1024,
          spawnImpl: spawnFor(
            { chunks: [], autoClose: false, closeOnSignals: [] },
            observer,
          ),
          deadlineMs: 20,
          terminateGraceMs: 10,
          killGraceMs: 10,
        },
        250,
      ),
    ).rejects.toMatchObject({
      code: "REAP_TIMEOUT",
      originalCode: "DEADLINE_EXCEEDED",
      originalFailure: { code: "DEADLINE_EXCEEDED" },
    });
    expect(observer.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  it("preserves a stdout failure when TERM and KILL cannot produce close", async () => {
    const observer = {};

    await expect(
      measure(
        {
          image: "test:image",
          maxBytes: 1024,
          spawnImpl: spawnFor(
            {
              stdoutError: new Error("stdout broke permanently"),
              autoClose: false,
              closeOnSignals: [],
            },
            observer,
          ),
          deadlineMs: 200,
          terminateGraceMs: 10,
          killGraceMs: 10,
        },
        250,
      ),
    ).rejects.toMatchObject({
      code: "REAP_TIMEOUT",
      originalCode: "SAVE_STREAM_ERROR",
      originalFailure: { code: "SAVE_STREAM_ERROR" },
    });
    expect(observer.child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  it("returns the overall deadline error when SIGTERM successfully reaps docker save", async () => {
    const observer = {};

    await expect(
      measure(
        {
          image: "test:image",
          maxBytes: 1024,
          spawnImpl: spawnFor({ chunks: [], autoClose: false }, observer),
          deadlineMs: 20,
          terminateGraceMs: 10,
          killGraceMs: 10,
        },
        250,
      ),
    ).rejects.toMatchObject({ code: "DEADLINE_EXCEEDED", deadlineMs: 20 });
    expect(observer.child.kill.mock.calls).toEqual([["SIGTERM"]]);
  });

  it("streams a large input through a slow compressor while respecting backpressure", async () => {
    const observer = {};
    const chunks = Array.from({ length: 64 }, () => Buffer.alloc(64 * 1024, 0x5a));
    const sourceBytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const slowCompressor = () =>
      new Transform({
        writableHighWaterMark: 1024,
        readableHighWaterMark: 1024,
        transform(chunk, _encoding, callback) {
          setTimeout(() => callback(null, chunk), 1);
        },
      });

    const result = await measure(
      {
        image: "test:image",
        maxBytes: sourceBytes,
        spawnImpl: spawnFor({ chunks }, observer),
        createGzipImpl: slowCompressor,
        deadlineMs: 2_000,
      },
      2_500,
    );

    expect(result).toEqual({ compressedBytes: sourceBytes, sourceBytes });
    expect(observer.child.backpressureCount).toBeGreaterThan(0);
  });
});

describe("RuntimeImageMeasurementError", () => {
  it("is exported for callers to classify failures", () => {
    expect(RuntimeImageMeasurementError).toBeTypeOf("function");
  });
});
