/**
 * 会议的纯逻辑（prd-routines 3）。从 dept-cockpit 的 `lib/meeting-helpers.ts` 迁入。
 *
 * `agenda` 与 `resolutions` 存成 Json 而不是两张子表，是因为它们**只属于这一次会**、
 * 不被别处引用、也不需要单独查询——议程条目的全部生命周期就是"在这次会上被念一遍"。
 * 唯一的例外是决议转成的任务，那条线靠 `convertedTaskId` 记住。
 *
 * Json 列读回来是 `unknown`，所以 parse 函数负责把它收窄成可展示的形状：
 * 脏数据只在展示层忽略而不是抛错，写操作仍按 raw index 原样保留——一条格式坏了的
 * 旧决议既不该让整个会议页打不开，也不该在编辑另一条决议时被静默删除。
 */

/** 一条决议。存在 Meeting.resolutions 里 */
export type Resolution = {
  text: string;
  assignee: string;
  /** YYYY-MM-DD，可空 */
  dueDate: string | null;
  /** 转成任务后记下 id：**同一条决议不能转两次** */
  convertedTaskId: string | null;
  /** 由录音纪要聚合产生时保留来源，供审计与后续重建使用。 */
  recordingId?: string;
  candidateId?: string;
};

export type ResolutionSnapshot =
  | {
      kind: "automatic";
      recordingId: string;
      candidateId: string;
    }
  | {
      kind: "legacy";
      text: string;
      assignee: string;
      dueDate: string | null;
      convertedTaskId: string | null;
    };

export type ResolutionEntry = {
  rawIndex: number;
  raw: Record<string, unknown>;
  resolution: Resolution;
};

export function parseAgenda(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function parseResolutionItem(item: unknown): { raw: Record<string, unknown>; resolution: Resolution } | null {
  if (typeof item !== "object" || item === null || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;
  const resolution: Resolution = {
    text: typeof raw.text === "string" ? raw.text : "",
    assignee: typeof raw.assignee === "string" && raw.assignee ? raw.assignee : "我",
    dueDate: typeof raw.dueDate === "string" ? raw.dueDate : null,
    convertedTaskId: typeof raw.convertedTaskId === "string" ? raw.convertedTaskId : null,
    ...(typeof raw.recordingId === "string" ? { recordingId: raw.recordingId } : {}),
    ...(typeof raw.candidateId === "string" ? { candidateId: raw.candidateId } : {}),
  };
  return resolution.text.trim().length > 0 ? { raw, resolution } : null;
}

export function resolutionEntries(json: unknown): ResolutionEntry[] {
  if (!Array.isArray(json)) return [];
  const entries: ResolutionEntry[] = [];
  json.forEach((item, rawIndex) => {
    const parsed = parseResolutionItem(item);
    if (parsed) entries.push({ rawIndex, ...parsed });
  });
  return entries;
}

export function parseResolutions(json: unknown): Resolution[] {
  return resolutionEntries(json).map((entry) => entry.resolution);
}

export function resolutionSnapshot(resolution: Resolution): ResolutionSnapshot {
  if (resolution.recordingId && resolution.candidateId) {
    return {
      kind: "automatic",
      recordingId: resolution.recordingId,
      candidateId: resolution.candidateId,
    };
  }
  return {
    kind: "legacy",
    text: resolution.text,
    assignee: resolution.assignee,
    dueDate: resolution.dueDate,
    convertedTaskId: resolution.convertedTaskId,
  };
}

export function isResolutionSnapshot(value: unknown): value is ResolutionSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (snapshot.kind === "automatic") {
    return typeof snapshot.recordingId === "string" && snapshot.recordingId.length > 0
      && typeof snapshot.candidateId === "string" && snapshot.candidateId.length > 0;
  }
  return snapshot.kind === "legacy"
    && typeof snapshot.text === "string"
    && typeof snapshot.assignee === "string"
    && (typeof snapshot.dueDate === "string" || snapshot.dueDate === null)
    && (typeof snapshot.convertedTaskId === "string" || snapshot.convertedTaskId === null);
}

export function resolutionMatchesSnapshot(resolution: Resolution, expected: unknown): boolean {
  if (!isResolutionSnapshot(expected)) return false;
  const current = resolutionSnapshot(resolution);
  if (current.kind !== expected.kind) return false;
  if (current.kind === "automatic" && expected.kind === "automatic") {
    return current.recordingId === expected.recordingId && current.candidateId === expected.candidateId;
  }
  if (current.kind === "legacy" && expected.kind === "legacy") {
    return current.text === expected.text
      && current.assignee === expected.assignee
      && current.dueDate === expected.dueDate
      && current.convertedTaskId === expected.convertedTaskId;
  }
  return false;
}

export function resolutionMatchesConvertedIdentity(resolution: Resolution, expected: unknown): boolean {
  if (!isResolutionSnapshot(expected) || resolution.convertedTaskId === null) return false;
  const current = resolutionSnapshot(resolution);
  if (current.kind === "automatic" && expected.kind === "automatic") {
    return current.recordingId === expected.recordingId && current.candidateId === expected.candidateId;
  }
  if (current.kind === "legacy" && expected.kind === "legacy") {
    return current.text === expected.text
      && current.assignee === expected.assignee
      && current.dueDate === expected.dueDate;
  }
  return false;
}

/** 还没转成任务的决议有几条。会议列表上用它提示「还有 N 条决议没派下去」 */
export function pendingResolutionCount(json: unknown): number {
  return parseResolutions(json).filter((r) => r.convertedTaskId == null).length;
}

/**
 * datetime-local 的值（"2026-07-08T14:30"）转成时间戳。
 *
 * **按进程时区解释**，与 `lib/date.ts` 的假设一致——全平台只有这一套时区假设：
 * 进程时区就是用户所在时区。部署时必须给容器设 `TZ=Asia/Shanghai`，
 * 否则这里和「今天」的判定会一起错（BUILD_PLAN Phase 3 已记）。
 */
export function parseMeetingTime(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 时间戳转回 datetime-local 的值，编辑表单要用 */
export function toDatetimeLocal(value: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(
    value.getHours(),
  )}:${pad(value.getMinutes())}`;
}
