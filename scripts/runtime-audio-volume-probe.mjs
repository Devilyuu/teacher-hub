import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const LABEL = "teacher-desk.runtime-audio-volume-probe";
const TARGET = "/var/lib/teacher-desk-audio";

function docker(args) {
  const result = spawnSync("docker", args, { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || `docker ${args[0]} failed`;
    throw new Error(detail.trim());
  }
  return result.stdout.trim();
}

export function probeFreshAudioVolume({ image }) {
  const volume = `teacher-desk-runtime-audio-probe-${randomUUID()}`;
  let created = false;
  let primaryError;
  try {
    docker(["volume", "create", "--label", `${LABEL}=${volume}`, volume]);
    created = true;
    docker([
      "run", "--rm", "--user", "node",
      "--mount", `type=volume,source=${volume},target=${TARGET}`,
      "--entrypoint", "sh", image, "-ceu",
      `test "$(stat -c '%U:%G:%a' ${TARGET})" = 'node:node:700'
touch ${TARGET}/.permission-probe
chmod 600 ${TARGET}/.permission-probe
test "$(stat -c '%U:%G:%a' ${TARGET}/.permission-probe)" = 'node:node:600'`,
    ]);
  } catch (error) {
    primaryError = error;
  } finally {
    if (created) {
      try {
        const labels = JSON.parse(docker(["volume", "inspect", "--format", "{{json .Labels}}", volume]));
        if (labels?.[LABEL] !== volume) throw new Error(`refusing to remove unverified volume ${volume}`);
        docker(["volume", "rm", volume]);
      } catch (cleanupError) {
        if (primaryError) throw new AggregateError([primaryError, cleanupError], "runtime audio volume probe and cleanup failed");
        throw cleanupError;
      }
    }
  }
  if (primaryError) throw primaryError;
}
