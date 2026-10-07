-- User.role:默认 user;存量账号里用户名 admin 的账号回填为管理员
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

UPDATE "User" SET "role" = 'admin' WHERE "name" = 'admin';
