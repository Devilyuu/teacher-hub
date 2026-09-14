import { maintenanceGuard } from "@/lib/maintenance-auth";
import { maintainTranscriptionWithRuntime } from "@/lib/transcription/runtime";

export async function POST(request: Request) {
  const denied = maintenanceGuard(request);
  if (denied) return denied;

  try {
    return Response.json(await maintainTranscriptionWithRuntime(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json(
      { error: "maintenance_failed" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
