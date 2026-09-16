-- Add memoryEnabled and clarifyEnabled to User table
-- These control feature toggles for individual users.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "memoryEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "clarifyEnabled" BOOLEAN NOT NULL DEFAULT true;
