import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getHealthStatus } from "@/lib/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getHealthStatus(() => prisma.$queryRaw`SELECT 1`);
  return NextResponse.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
