import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

type Env = Record<string, string | undefined>;

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function maintenanceTokenMatches(candidate: string | undefined, env: Env = process.env): boolean {
  const expected = env.MAINTENANCE_TOKEN;
  if (!candidate || !expected) return false;
  return timingSafeEqual(digest(candidate), digest(expected));
}

export function maintenanceGuard(request: Request, env: Env = process.env): Response | null {
  if (maintenanceTokenMatches(request.headers.get("x-maintenance-token") ?? undefined, env)) return null;
  return Response.json(
    { error: "unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}
