export async function uploadThenMaybeTranscribe(options: {
  upload(): Promise<{ id: string }>;
  transcribe(id: string): Promise<void>;
  transcriptionEnabled: boolean;
  asrConfigured: boolean;
}): Promise<{
  uploaded: true;
  id: string;
  transcription: "disabled" | "unconfigured" | "completed" | "failed";
  notice: string;
}> {
  const uploaded = await options.upload();
  if (!options.transcriptionEnabled) {
    return { uploaded: true, id: uploaded.id, transcription: "disabled", notice: "录音已上传并保存在本机。" };
  }
  if (!options.asrConfigured) {
    return {
      uploaded: true,
      id: uploaded.id,
      transcription: "unconfigured",
      notice: "录音已上传；腾讯云转写尚未配置，可在设置页完成配置后重试。",
    };
  }
  try {
    await options.transcribe(uploaded.id);
    return { uploaded: true, id: uploaded.id, transcription: "completed", notice: "录音已上传并完成转写。" };
  } catch {
    return {
      uploaded: true,
      id: uploaded.id,
      transcription: "failed",
      notice: "录音已上传，但转写失败；文件无需重复上传，可稍后重试转写。",
    };
  }
}
