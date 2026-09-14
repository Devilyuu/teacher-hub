import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const buildRoot = resolve(projectRoot, ".next");
const configuredAudioRoot = process.env.AUDIO_TEMP_ROOT?.trim();
const resolvedAudioRoot = configuredAudioRoot && isAbsolute(configuredAudioRoot)
  ? resolve(configuredAudioRoot)
  : null;
const audioRootInvalid = Boolean(configuredAudioRoot) && (
  !resolvedAudioRoot || resolvedAudioRoot === projectRoot || isInside(projectRoot, resolvedAudioRoot)
);

if (audioRootInvalid) {
  console.error("AUDIO_TEMP_ROOT 必须是仓库之外的绝对路径");
  process.exit(1);
}

if (!existsSync(buildRoot)) {
  console.error("缺少 .next 构建产物，请先运行 npm run build");
  process.exit(1);
}

function manifestsUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const pathname = resolve(directory, entry.name);
    if (entry.isDirectory()) return manifestsUnder(pathname);
    return entry.name.endsWith(".nft.json") ? [pathname] : [];
  });
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== "" && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent);
}

const privateRoots = [
  resolve(projectRoot, ".env"),
  resolve(projectRoot, "data"),
  resolve(projectRoot, "docs"),
];
if (resolvedAudioRoot) privateRoots.push(resolvedAudioRoot);

const violations = [];

for (const manifestPath of manifestsUnder(buildRoot)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const tracedPath of manifest.files ?? []) {
    const absolutePath = resolve(dirname(manifestPath), tracedPath);
    if (
      absolutePath === privateRoots[0] ||
      isInside(privateRoots[1], absolutePath) ||
      isInside(privateRoots[2], absolutePath) ||
      (privateRoots[3] && (absolutePath === privateRoots[3] || isInside(privateRoots[3], absolutePath)))
    ) {
      violations.push(`${relative(projectRoot, manifestPath)} -> ${relative(projectRoot, absolutePath)}`);
    }
  }
}

if (violations.length > 0) {
  console.error("构建追踪包含不应进入应用镜像的私密运行时文件：");
  for (const violation of violations.slice(0, 50)) console.error(`- ${violation}`);
  if (violations.length > 50) console.error(`- 另有 ${violations.length - 50} 项未显示`);
  process.exit(1);
}

console.log("构建追踪检查通过：未包含 .env、data/ 或 docs/ 文件");
