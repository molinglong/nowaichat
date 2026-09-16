-- 为 GeneratedImage 添加 size 字段,记录生图请求时的尺寸参数
ALTER TABLE "GeneratedImage" ADD COLUMN "size" TEXT NOT NULL DEFAULT '1024*1024';
