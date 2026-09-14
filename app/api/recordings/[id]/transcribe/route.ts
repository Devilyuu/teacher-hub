import { sessionGuard } from "@/lib/server-auth";
import { safeTranscriptionError } from "@/lib/transcription/route-error";
import { transcribeRecordingWithRuntime } from "@/lib/transcription/runtime";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await sessionGuard();
  if (denied) return denied;

  try {
    const result = await transcribeRecordingWithRuntime((await context.params).id);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json(
      { error: safeTranscriptionError(error) },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  }
}
