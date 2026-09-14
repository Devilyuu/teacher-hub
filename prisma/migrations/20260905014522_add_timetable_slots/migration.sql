-- CreateTable
CREATE TABLE "TimetableSlot" (
    "id" TEXT NOT NULL,
    "semesterId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "periodStart" INTEGER NOT NULL,
    "periodEnd" INTEGER NOT NULL,
    "weeks" INTEGER[],
    "weeksText" TEXT NOT NULL,
    "courseName" TEXT NOT NULL,
    "className" TEXT,
    "location" TEXT,
    "rawText" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableSlot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimetableSlot_semesterId_weekday_periodStart_idx" ON "TimetableSlot"("semesterId", "weekday", "periodStart");

-- AddForeignKey
ALTER TABLE "TimetableSlot" ADD CONSTRAINT "TimetableSlot_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "Semester"("id") ON DELETE CASCADE ON UPDATE CASCADE;
