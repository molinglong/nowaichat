-- GeneratedImage 增加 parentId/editType/maskRect, 支持二次创作链路
ALTER TABLE "GeneratedImage" ADD COLUMN "parentId" TEXT;
ALTER TABLE "GeneratedImage" ADD COLUMN "editType" TEXT NOT NULL DEFAULT 't2i';
ALTER TABLE "GeneratedImage" ADD COLUMN "maskRect" TEXT;

-- 自关联外键
CREATE INDEX "GeneratedImage_parentId_idx" ON "GeneratedImage"("parentId");
