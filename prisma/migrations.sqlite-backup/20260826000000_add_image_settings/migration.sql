-- Add image model and size preferences to User table
ALTER TABLE "User" ADD COLUMN "imageModel" TEXT NOT NULL DEFAULT 'wanx2.1-t2i-turbo';
ALTER TABLE "User" ADD COLUMN "imageSize" TEXT NOT NULL DEFAULT '1024*1024';
