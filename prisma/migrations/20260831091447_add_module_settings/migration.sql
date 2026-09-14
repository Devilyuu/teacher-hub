-- CreateTable
CREATE TABLE "ModuleSetting" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "ownerId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModuleSetting_pkey" PRIMARY KEY ("key")
);
