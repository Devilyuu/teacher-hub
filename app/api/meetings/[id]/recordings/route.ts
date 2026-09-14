import { sessionGuard } from "@/lib/server-auth";
import { safeTranscriptionError } from "@/lib/transcription/route-error";
import { uploadRecordingWithRuntime } from "@/lib/transcription/runtime";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await sessionGuard();
  if (denied) return denied;

  try {
    const form = await request.formData();
    const file = form.get("audio");
    if (!(file instanceof File)) {
      return Response.json({ error: "请选择音频文件" }, { status: 400 });
    }
    const result = await uploadRecordingWithRuntime(
      (await context.params).id,
      file,
      form.get("cloudDisclosureAccepted") === "true",
    );
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: safeTranscriptionError(error) },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
