-- CreateTable
CREATE TABLE "StudyNote" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceMessageId" TEXT,
    "subject" TEXT,
    "topic" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "analysis" TEXT,
    "mastery" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stability" DOUBLE PRECISION,
    "difficulty" DOUBLE PRECISION,
    "state" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3),
    "lastReviewAt" TIMESTAMP(3),
    "reps" INTEGER NOT NULL DEFAULT 0,
    "lapses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyNoteReviewLog" (
    "id" TEXT NOT NULL,
    "noteId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "masteryBefore" DOUBLE PRECISION NOT NULL,
    "masteryAfter" DOUBLE PRECISION NOT NULL,
    "ratedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudyNoteReviewLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudyNote_userId_dueAt_idx" ON "StudyNote"("userId", "dueAt");

-- CreateIndex
CREATE INDEX "StudyNote_userId_subject_idx" ON "StudyNote"("userId", "subject");

-- CreateIndex
CREATE INDEX "StudyNoteReviewLog_noteId_ratedAt_idx" ON "StudyNoteReviewLog"("noteId", "ratedAt");

-- AddForeignKey
ALTER TABLE "StudyNote" ADD CONSTRAINT "StudyNote_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyNoteReviewLog" ADD CONSTRAINT "StudyNoteReviewLog_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "StudyNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

