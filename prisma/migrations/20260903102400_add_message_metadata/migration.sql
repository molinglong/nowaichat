-- Add structured UI metadata column to Message table.
-- Used by the frontend to decide how to render a message (e.g. summary cards,
-- memory injections, tool outputs). Only the backend writes this field, and
-- consumers dispatch on the JSON `kind` field.

-- AlterTable
ALTER TABLE "Message" ADD COLUMN "metadata" TEXT;
