const SAFE_MESSAGES = [
  "会议不存在",
  "请先确认音频将上传到腾讯云做转写",
  "只支持 m4a、mp3、wav、aac 音频",
  "音频格式与扩展名不一致",
  "音频内容格式与扩展名不一致",
  "单个音频不能超过 100MB",
  "音频时长不能超过 2 小时",
  "录音总量已满，请先确认或删除既有录音",
  "录音目录磁盘空间不足，请先确认或删除既有录音",
  "无法读取音频元数据，请确认文件未损坏且格式正确",
  "腾讯云转写尚未配置，请先在设置页完成配置",
  "录音无法抢占，可能正在转写或已被关闭",
] as const;

export function safeTranscriptionError(error: unknown): string {
  if (error instanceof Error && SAFE_MESSAGES.includes(error.message as (typeof SAFE_MESSAGES)[number])) {
    return error.message;
  }
  return "操作失败，请稍后重试";
}
