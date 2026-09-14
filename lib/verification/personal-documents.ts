export const OWNER_CHECK = "Attachment_single_owner";
export const CATEGORY_FK = "Attachment_docCategoryId_fkey";

type ErrorRecord = {
  code?: unknown;
  message?: unknown;
  meta?: unknown;
  cause?: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function collectEvidence(value: unknown, seen = new Set<object>()): string[] {
  if (value == null) return [];
  if (typeof value === "string" || typeof value === "number") return [String(value)];
  if (typeof value !== "object") return [];
  if (seen.has(value)) return [];
  seen.add(value);

  if (value instanceof Error) {
    const error = value as Error & ErrorRecord;
    return [
      error.message,
      ...collectEvidence(error.meta, seen),
      ...collectEvidence(error.cause, seen),
      ...collectEvidence(error.code, seen),
    ];
  }

  const record = value as Record<string, unknown>;
  return Object.values(record).flatMap((nested) => collectEvidence(nested, seen));
}

function errorEvidence(error: unknown): string {
  if (typeof error !== "object" || error == null) return "";
  const record = error as ErrorRecord;
  return [
    typeof record.message === "string" ? record.message : "",
    ...collectEvidence(record.meta),
    ...collectEvidence(record.cause),
  ].join("\n");
}

function hasExactConstraintName(evidence: string, constraint: string): boolean {
  const escaped = constraint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9_])${escaped}(?:$|[^A-Za-z0-9_])`).test(evidence);
}

function classifyConstraintError(
  error: unknown,
  constraint: string,
  databaseCode: "23514" | "23503",
  failureMessage: string,
) {
  const evidence = errorEvidence(error);
  const record = (typeof error === "object" && error != null ? error : {}) as ErrorRecord;
  const prismaCode = typeof record.code === "string" ? record.code : null;

  assert(
    hasExactConstraintName(evidence, constraint),
    `${failureMessage}，但错误的 message/meta/cause 中没有精确约束名 ${constraint}：${evidence}`,
  );

  return {
    prismaCode,
    databaseCode: new RegExp(`(?:^|\\D)${databaseCode}(?:$|\\D)`).test(evidence)
      ? databaseCode
      : null,
    proof: constraint,
  };
}

export function classifyOwnerCheckError(error: unknown) {
  return classifyConstraintError(error, OWNER_CHECK, "23514", "违规附件写入失败");
}

export function classifyCategoryRestrictError(error: unknown) {
  return classifyConstraintError(error, CATEGORY_FK, "23503", "删除被引用分类失败");
}
