-- 高德地图 Key(plan_trip 行程卡片):每用户一份配置,
-- jsKey/安全密钥经 /api/amap-config 下发浏览器渲染行程地图,
-- wsKey(加密)供服务端 POI 坐标校准;未配置时回落环境变量。

-- CreateTable
CREATE TABLE "AmapKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jsKey" TEXT NOT NULL,
    "encryptedSec" TEXT,
    "encryptedWs" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AmapKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AmapKey_userId_key" ON "AmapKey"("userId");

-- AddForeignKey
ALTER TABLE "AmapKey" ADD CONSTRAINT "AmapKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
