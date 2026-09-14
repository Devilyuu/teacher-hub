import { AUDIO_FORMATS, AUDIO_MAX_BYTES, AUDIO_MAX_DURATION_SEC } from "./policy";

type FileCandidate = Pick<File, "name" | "type" | "size">;

export function validateClientAudioFile(file: FileCandidate): string | null {
  if (file.size <= 0) return "请选择非空音频文件";
  if (file.size > AUDIO_MAX_BYTES) return "单个音频不能超过 100MB";
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const allowedMimes = extension ? AUDIO_FORMATS[extension as keyof typeof AUDIO_FORMATS] : undefined;
  if (!extension || !allowedMimes) return "仅支持 m4a、mp3、wav、aac 音频";
  if (!(allowedMimes as readonly string[]).includes(file.type.toLowerCase())) return "音频格式与扩展名不一致";
  return null;
}

type AudioElementLike = {
  duration: number;
  preload: string;
  src: string;
  onloadedmetadata: null | (() => void);
  onerror: null | (() => void);
};

type DurationProbeDependencies = {
  createObjectURL(file: Blob): string;
  revokeObjectURL(url: string): void;
  createAudio(): AudioElementLike;
  setTimer(callback: () => void, milliseconds: number): unknown;
  clearTimer(timer: unknown): void;
};

export function probeBrowserAudioDuration(
  file: File,
  deps: DurationProbeDependencies = {
    createObjectURL: (candidate) => URL.createObjectURL(candidate),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    createAudio: () => document.createElement("audio") as unknown as AudioElementLike,
    setTimer: (callback, milliseconds) => setTimeout(callback, milliseconds),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  },
): Promise<number | null> {
  return new Promise((resolve) => {
    const url = deps.createObjectURL(file);
    const audio = deps.createAudio();
    let settled = false;
    const timerRef: { current?: unknown } = {};
    const finish = (duration: number | null) => {
      if (settled) return;
      settled = true;
      if (timerRef.current !== undefined) deps.clearTimer(timerRef.current);
      audio.onloadedmetadata = null;
      audio.onerror = null;
      deps.revokeObjectURL(url);
      resolve(duration);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
    timerRef.current = deps.setTimer(() => finish(null), 5_000);
  });
}

export async function preflightClientAudio(
  file: File,
  probeDuration: (file: File) => Promise<number | null> = probeBrowserAudioDuration,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const fileError = validateClientAudioFile(file);
  if (fileError) return { ok: false, error: fileError };
  try {
    const duration = await probeDuration(file);
    if (duration !== null && duration > AUDIO_MAX_DURATION_SEC) {
      return { ok: false, error: "音频时长不能超过 2 小时" };
    }
  } catch {
    // Browser codec support is best-effort; music-metadata remains authoritative on the server.
  }
  return { ok: true };
}
