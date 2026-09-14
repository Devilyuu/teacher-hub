import {
  RuntimeImageProbeError,
  probeRuntimeImageContents,
} from "./runtime-image-content-probe.mjs";
import {
  RuntimeImageMeasurementError,
  measureCompressedDistributionSize,
} from "./runtime-image-size.mjs";
import { probeFreshAudioVolume } from "./runtime-audio-volume-probe.mjs";

const image = process.env.RUNTIME_IMAGE ?? "keticompass-app:latest";
const maxBytes = 850 * 1024 * 1024;

const toMiB = (bytes) => (bytes / 1024 / 1024).toFixed(1);

let compressedBytes;
try {
  ({ compressedBytes } = await measureCompressedDistributionSize({ image, maxBytes }));
} catch (error) {
  if (error instanceof RuntimeImageMeasurementError) {
    const measured = Number.isFinite(error.compressedBytes)
      ? `${toMiB(error.compressedBytes)} MiB，`
      : "";
    const stderr = error.stderr ? `\n${error.stderr}` : "";
    console.error(
      `运行镜像压缩分发体积检查失败：${measured}上限 ${toMiB(maxBytes)} MiB；${error.message}${stderr}`,
    );
    process.exit(error.exitCode || 1);
  }
  throw error;
}

try {
  probeRuntimeImageContents({ image });
  probeFreshAudioVolume({ image });
} catch (error) {
  if (error instanceof RuntimeImageProbeError) {
    const output = error.stdout || error.stderr;
    console.error(`${error.message}${output ? `\n${output}` : ""}`);
    process.exit(error.exitCode || 1);
  }
  throw error;
}

console.log(
  `运行镜像检查通过：压缩分发体积 ${toMiB(compressedBytes)} MiB（上限 ${toMiB(maxBytes)} MiB），未包含源码、测试或私密目录`,
);
