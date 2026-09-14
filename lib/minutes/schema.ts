import { z } from "zod";

const dueDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day;
}, "日期无效").nullable();

const textSchema = z.string().trim().max(20_000);
const candidateIdSchema = z.string().regex(/^(resolution|task|issue)-[a-z0-9-]{1,80}$/);

const generatedResolutionSchema = z.object({
  text: textSchema.min(1),
  assignee: z.string().trim().min(1).max(100).default("我"),
  dueDate: dueDateSchema.default(null),
}).strict();

const generatedTaskSchema = z.object({
  title: textSchema.min(1),
  assignee: z.string().trim().min(1).max(100).default("我"),
  dueDate: dueDateSchema.default(null),
  selected: z.boolean().default(true),
}).strict();

const generatedOpenIssueSchema = z.object({ text: textSchema.min(1) }).strict();

export const generatedMinutesDraftSchema = z.object({
  summary: textSchema,
  discussion: textSchema,
  resolutions: z.array(generatedResolutionSchema).max(100),
  tasks: z.array(generatedTaskSchema).max(100),
  openIssues: z.array(generatedOpenIssueSchema).max(100),
}).strict();

export const minutesDraftSchema = z.object({
  summary: textSchema,
  discussion: textSchema,
  resolutions: z.array(generatedResolutionSchema.extend({ id: candidateIdSchema }).strict()).max(100),
  tasks: z.array(generatedTaskSchema.extend({
    id: candidateIdSchema,
    createdTaskId: z.string().min(1).max(100).nullable().default(null),
  }).strict()).max(100),
  openIssues: z.array(generatedOpenIssueSchema.extend({ id: candidateIdSchema }).strict()).max(100),
}).strict();

export const clientMinutesDraftSchema = minutesDraftSchema.superRefine((draft, context) => {
  draft.tasks.forEach((task, index) => {
    if (task.createdTaskId !== null) {
      context.addIssue({
        code: "custom",
        path: ["tasks", index, "createdTaskId"],
        message: "任务回写标记不允许由客户端设置",
      });
    }
  });
});

export type GeneratedMinutesDraft = z.infer<typeof generatedMinutesDraftSchema>;
export type MinutesDraft = z.infer<typeof minutesDraftSchema>;

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function candidateId(kind: "resolution" | "task" | "issue", index: number, value: unknown) {
  return `${kind}-${index + 1}-${hashText(JSON.stringify(value))}`;
}

export function withStableCandidateIds(input: GeneratedMinutesDraft): MinutesDraft {
  const draft = generatedMinutesDraftSchema.parse(input);
  return minutesDraftSchema.parse({
    ...draft,
    resolutions: draft.resolutions.map((candidate, index) => ({
      id: candidateId("resolution", index, candidate),
      ...candidate,
    })),
    tasks: draft.tasks.map((candidate, index) => ({
      id: candidateId("task", index, candidate),
      ...candidate,
    })),
    openIssues: draft.openIssues.map((candidate, index) => ({
      id: candidateId("issue", index, candidate),
      ...candidate,
    })),
  });
}

export function createManualMinutesDraft(): MinutesDraft {
  return {
    summary: "",
    discussion: "",
    resolutions: [],
    tasks: [],
    openIssues: [],
  };
}

export function hasPersistedMinutesDraft(input: {
  draftSummary: string | null;
  draftDiscussion: string | null;
  draftResolutions: unknown;
  draftTasks: unknown;
  draftOpenIssues: unknown;
}): boolean {
  return minutesDraftSchema.safeParse({
    summary: input.draftSummary,
    discussion: input.draftDiscussion,
    resolutions: input.draftResolutions,
    tasks: input.draftTasks,
    openIssues: input.draftOpenIssues,
  }).success;
}
