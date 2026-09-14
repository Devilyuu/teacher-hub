"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formMessageClass } from "@/lib/form-state";
import { RECORDING_STATUS_LABELS } from "@/lib/labels";
import type { RecordingStatus } from "@/lib/generated/prisma/enums";
import { confirmRecordingAudioDeletion } from "@/lib/minutes/client-flow";
import { minutesDraftSchema } from "@/lib/minutes/schema";
import { uploadThenMaybeTranscribe } from "@/lib/transcription/client-flow";
import {
  deleteRecordingAudioAction,
  generateMinutesDraftAction,
  initializeManualMinutesAction,
} from "../minutes-actions";
import { MinutesEditor } from "./minutes-editor";
import {
  preflightClientAudio,
  probeBrowserAudioDuration,
  validateClientAudioFile,
} from "@/lib/transcription/client-preflight";

export type RecordingPanelItem = {
  id: string;
  originalName: string;
  status: RecordingStatus;
  durationSec: number | null;
  transcript: string | null;
  draftSummary: string | null;
  draftDiscussion: string | null;
  draftResolutions: unknown;
  draftTasks: unknown;
  draftOpenIssues: unknown;
  expiresAt: Date | null;
  audioExpiryState: "expired" | "day-six" | null;
  confirmedAt: Date | null;
  audioDeletedAt: Date | null;
  errorCode: string | null;
  errorNote: string | null;
  cloudConsentAt: Date | null;
  createdAt: Date;
};

export function RecordingPanel({
  meetingId,
  transcriptionEnabled,
  asrConfigured,
  minutesConfigured,
  recordings,
  toggleAction,
}: {
  meetingId: string;
  transcriptionEnabled: boolean;
  asrConfigured: boolean;
  minutesConfigured: boolean;
  recordings: RecordingPanelItem[];
  toggleAction: (formData: FormData) => void | Promise<void>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageIsSuccess, setMessageIsSuccess] = useState(false);
  const [selectionError, setSelectionError] = useState("");

  async function transcribe(id: string) {
    const response = await fetch(`/api/recordings/${id}/transcribe`, { method: "POST" });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error ?? "转写失败");
  }

  async function inspectSelection(file: File | undefined) {
    if (!file) return setSelectionError("");
    const immediateError = validateClientAudioFile(file);
    if (immediateError) return setSelectionError(immediateError);
    const result = await preflightClientAudio(file, probeBrowserAudioDuration);
    setSelectionError(result.ok ? "" : result.error);
  }

  async function upload(formData: FormData) {
    setBusy(true);
    setMessage("");
    setMessageIsSuccess(false);
    try {
      const file = formData.get("audio");
      if (!(file instanceof File)) throw new Error("请选择音频文件");
      const preflight = await preflightClientAudio(file, probeBrowserAudioDuration);
      if (!preflight.ok) throw new Error(preflight.error);
      formData.set("cloudDisclosureAccepted", String(formData.get("cloudDisclosure") === "on"));
      const result = await uploadThenMaybeTranscribe({
        transcriptionEnabled,
        asrConfigured,
        async upload() {
          const response = await fetch(`/api/meetings/${meetingId}/recordings`, { method: "POST", body: formData });
          const body = await response.json() as { id?: string; error?: string };
          if (!response.ok || !body.id) throw new Error(body.error ?? "上传失败");
          return { id: body.id };
        },
        transcribe,
      });
      setMessage(result.notice);
      setMessageIsSuccess(true);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败");
      setMessageIsSuccess(false);
    } finally {
      setBusy(false);
    }
  }

  async function retry(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await transcribe(id);
      setMessage("转写已完成。");
      setMessageIsSuccess(true);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "转写失败");
      setMessageIsSuccess(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-medium">会议录音与转写</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            支持 m4a、mp3、wav、aac，单个不超过 100MB、2 小时。音频保存在独立私有临时目录。
          </p>
        </div>
        <form action={toggleAction} className="flex items-center gap-2 text-xs">
          <input name="enabled" type="checkbox" defaultChecked={transcriptionEnabled} />
          <span>允许本会议转写</span>
          <Button type="submit" size="sm" variant="outline">保存</Button>
        </form>
      </div>

      {transcriptionEnabled && !asrConfigured ? (
        <p className="rounded-lg bg-[var(--h-amber-bg)] px-3 py-2 text-xs text-[var(--h-amber-fg)]">
          腾讯云转写尚未配置。录音仍可成功上传并显示在列表中，配置完成前不会发起转写，也无需重复上传。
        </p>
      ) : null}

      <form action={upload} className="space-y-3 rounded-xl bg-muted/40 p-4">
        {/* 文件输入统一走样式化 Input（同 attachment-panel / document-library），
            裸 <input type="file"> 的浏览器默认样式和旁边的胶囊按钮不是一个产品 */}
        <Input
          name="audio"
          type="file"
          accept=".m4a,.mp3,.wav,.aac"
          required
          disabled={busy}
          onChange={(event) => void inspectSelection(event.currentTarget.files?.[0])}
          className="file:mr-3 file:rounded-full file:border-0 file:bg-muted file:px-3 file:py-1 file:text-xs"
        />
        {selectionError ? <p className="text-xs text-destructive">{selectionError}</p> : null}
        {transcriptionEnabled ? (
          <label className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <input name="cloudDisclosure" type="checkbox" required />
            <span>
              我确认本次音频会发送到腾讯云完成一次识别请求；请求完成后本系统不保留云端副本。
              纪要确认后会立即删除本机原音频；未确认时第 6 天提醒、第 7 天自动删除。每次上传都需要重新确认。
            </span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">本会议已关闭转写：文件只保存在本机，不会发送到云端。</p>
        )}
        <Button type="submit" size="sm" disabled={busy || Boolean(selectionError)}>{busy ? "处理中…" : "上传录音"}</Button>
      </form>

      {message ? (
        <p className={formMessageClass(messageIsSuccess)}>
          {message}
        </p>
      ) : null}
      {recordings.length ? (
        <ul className="space-y-3">
          {recordings.map((recording) => {
            const canRetryDeletion = recording.status === "DELETE_PENDING"
              && recording.errorCode === "AUDIO_DELETE_FAILED";
            const expiryNotice = recording.audioExpiryState === "expired"
              ? "原音频已到期，等待自动删除。"
              : recording.audioExpiryState === "day-six"
                ? "原音频将在 24 小时内自动删除，请尽快整理纪要。"
                : null;
            const parsedDraft = minutesDraftSchema.safeParse({
              summary: recording.draftSummary,
              discussion: recording.draftDiscussion,
              resolutions: recording.draftResolutions,
              tasks: recording.draftTasks,
              openIssues: recording.draftOpenIssues,
            });
            return (
              <li id={`recording-${recording.id}`} key={recording.id} className="scroll-mt-24 rounded-xl border border-border/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm">{recording.originalName}</span>
                  <span className="text-xs text-muted-foreground">{RECORDING_STATUS_LABELS[recording.status]}</span>
                </div>
                {recording.durationSec ? <p className="mt-1 text-xs text-muted-foreground">{recording.durationSec} 秒</p> : null}
                {recording.transcript ? <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{recording.transcript}</p> : null}
                {recording.errorNote ? <p className="mt-2 text-xs text-destructive">{recording.errorNote}</p> : null}
                {expiryNotice ? <p className="mt-2 text-xs text-[var(--h-amber-fg)]">{expiryNotice}</p> : null}
                {!recording.cloudConsentAt ? <p className="mt-2 text-xs text-muted-foreground">本机保存，不会上云转写。</p> : null}
                {asrConfigured && transcriptionEnabled && recording.cloudConsentAt && (recording.status === "UPLOADED" || recording.status === "FAILED") ? (
                  <Button className="mt-3" type="button" size="sm" variant="outline" disabled={busy} onClick={() => retry(recording.id)}>
                    {recording.status === "FAILED" ? "重试转写" : "开始转写"}
                  </Button>
                ) : null}
                {recording.transcript && !recording.confirmedAt ? (
                  parsedDraft.success ? (
                    <MinutesEditor recordingId={recording.id} meetingId={meetingId} initialDraft={parsedDraft.data} />
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {minutesConfigured ? (
                        <form action={generateMinutesDraftAction.bind(null, recording.id, meetingId)}>
                          <Button type="submit" size="sm" variant="outline">生成纪要草稿</Button>
                        </form>
                      ) : null}
                      <form action={initializeManualMinutesAction.bind(null, recording.id, meetingId)}>
                        <Button type="submit" size="sm" variant="outline">整理纪要</Button>
                      </form>
                    </div>
                  )
                ) : null}
                {recording.confirmedAt ? <p className="mt-2 text-xs text-[var(--h-green-fg)]">纪要已确认。</p> : null}
                {recording.audioDeletedAt ? (
                  <p className="mt-2 text-xs text-muted-foreground">原音频已删除；转写和纪要草稿仍保留。</p>
                ) : recording.status === "DELETE_PENDING" && !canRetryDeletion ? (
                  <p className="mt-2 text-xs text-muted-foreground">正在删除原音频，请稍候。</p>
                ) : recording.status !== "UPLOADING" && recording.status !== "TRANSCRIBING" ? (
                  <form
                    className="mt-2"
                    action={deleteRecordingAudioAction.bind(null, recording.id, meetingId)}
                    onSubmit={(event) => {
                      if (recording.status !== "DELETE_PENDING"
                        && !confirmRecordingAudioDeletion((notice) => window.confirm(notice))) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <Button type="submit" size="sm" variant="ghost">
                      {recording.status === "DELETE_PENDING" ? "重试删除" : "提前删除音频"}
                    </Button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : <p className="text-xs text-muted-foreground">还没有录音。</p>}
    </section>
  );
}
