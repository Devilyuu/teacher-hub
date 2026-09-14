import "server-only";

import { prisma } from "@/lib/db";
import { getMinutesHomeQueue } from "@/lib/minutes/home";

export function getMinutesHomeQueueWithRuntime(now = new Date()) {
  return getMinutesHomeQueue(now, prisma);
}
