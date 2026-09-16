-- Add ConversationSummary table for long-context compression
-- Stores compressed summaries of older conversation turns so that very long
-- chats do not exceed the model's context window. The latest summary (by
-- createdAt) for a conversation represents the most-compressed "far history".

-- CreateTable
CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "rangeStart" TEXT,
    "rangeEnd" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "modelId" TEXT,
    "coveredMessages" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationSummary_conversationId_createdAt_idx" ON "ConversationSummary"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
