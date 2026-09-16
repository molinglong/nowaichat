# Postgres 迁移说明

本项目已从 SQLite (`dev.db`) 迁移到 PostgreSQL（Docker 容器）。本页说明怎么用、怎么改 schema、怎么备份。

---

## 为什么换

SQLite 没法改字段类型（`ALTER COLUMN`）。之前每次改 schema 都要 drop 整张表重灌数据，导致我们反复从备份救回 `dev.db`。

Postgres 原生支持 `ALTER TABLE ALTER COLUMN`，从此改字段不再丢数据。

---

## 首次启动（一次）

### 1. 启动 Postgres

双击 `postgres-start.bat`（仓库根目录）。

它会：
- 检查 Docker 是否安装
- `docker compose up -d` 启动容器
- 等待 `pg_isready` 通过
- 打印版本

如果报错 "未检测到 Docker"，先装 Docker Desktop：https://www.docker.com/products/docker-desktop/

### 2. 在 Postgres 上建表

```powershell
npx prisma migrate deploy
```

这会按 `prisma/migrations/` 里的 12 个 SQL 文件依次执行，把表结构在 Postgres 里建出来。**不修改任何数据**，因为 Postgres 现在是空的。

### 3. 迁移旧 dev.db 数据

```powershell
node scripts/migrate-sqlite-to-postgres.cjs
```

它会：
- 自动备份 `dev.db` → `dev.db.before-pg-migration-<时间戳>`
- 读 SQLite 里 12 张业务表
- 按 FK 安全顺序插入 Postgres
- 输出前后行数对比

> **冲突策略**：`ON CONFLICT DO NOTHING`。如果某个 id 已存在（比如多次跑），不会报错也不会重复写入。可以放心重跑。

### 4. 切换 Prisma 客户端驱动

需要把 `src/lib/db.ts` 从 `PrismaLibSql` 换成 `PrismaPg`：

```bash
npm uninstall @prisma/adapter-libsql @libsql/client better-sqlite3
npm install @prisma/adapter-pg pg
```

然后改 `src/lib/db.ts`：

```ts
import { PrismaClient } from '@/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }

function createPrismaClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
```

接着重新生成客户端：

```bash
npx prisma generate
```

### 5. 启动 Next.js

```powershell
npm run dev
```

---

## 日常使用

| 场景 | 命令 |
|---|---|
| 启动 Postgres | `postgres-start.bat` |
| 停止 Postgres（数据保留） | `postgres-stop.bat` |
| 彻底清空 Postgres | `postgres-reset.bat` |
| 启动 Next.js | `npm run dev` |

Postgres 配了 `restart: unless-stopped`，电脑重启后容器自动起。

---

## 改 schema 的正确流程（**不再丢数据**）

过去（SQLite）的噩梦：
1. 改 schema.prisma
2. `prisma migrate dev`
3. Prisma 看到 SQLite 不支持 `ALTER COLUMN` → 自动 `DROP TABLE` + `CREATE TABLE`
4. **数据全没**

现在（Postgres）：
1. 改 `prisma/schema.prisma`
2. `npx prisma migrate dev --name <feature>`
3. Prisma 生成**真正的 `ALTER TABLE`** SQL
4. 自动 apply + 不丢数据

如果 Prisma 生成的 SQL 你想先看看：

```powershell
npx prisma migrate dev --create-only --name add_feature
# 检查 prisma/migrations/<时间戳>_add_feature/migration.sql
# 满意后再：
npx prisma migrate deploy
```

---

## 备份与恢复

### 自动备份

迁移脚本每次跑都会自动备份 `dev.db`。但既然现在数据在 Postgres 里，**dev.db 的备份可以慢慢清掉**——保留一个月再删。

### 手动备份 Postgres

```powershell
docker exec aichatt-postgres pg_dump -U admin aichatt > backup-%date:~0,4%%date:~5,2%%date:~8,2%.sql
```

文件会落在当前目录，完整 SQL 格式，可以压缩归档。

### 从备份恢复

```powershell
docker exec -i aichatt-postgres psql -U admin aichatt < backup-20260826.sql
```

### 备份进 Docker volume

更推荐：把 pg_dump 直接写进一个命名 volume，避免误删：

```powershell
docker exec aichatt-postgres pg_dump -U admin -Fc aichatt > "%USERPROFILE%\aichatt-backups\aichatt-%date:~0,4%%date:~5,2%%date:~8,2%.dump"
```

`pg_dump -Fc` 是 Postgres 自己的压缩格式，恢复用 `pg_restore`。普通 `pg_dump` 的纯 SQL 用 `psql` 恢复——任选其一。

---

## 常见问题

### Postgres 起不来

```powershell
docker logs aichatt-postgres
```

最常见原因：5432 端口被本机其他 Postgres 占了。改 `docker-compose.yml` 里的 `"5432:5432"` 为 `"5433:5432"`，再改 `.env` 里的端口。

### "Cannot find module '@prisma/adapter-pg'"

第 4 步忘了装。跑：

```powershell
npm install @prisma/adapter-pg pg
```

### 迁移脚本说 "Postgres User table does not exist"

第 2 步没跑。跑：

```powershell
npx prisma migrate deploy
```

### 想完全回到 SQLite

不推荐，但可行：
1. 改 `prisma/schema.prisma` 的 provider 回 `sqlite`
2. 改 `.env` 的 `DATABASE_URL` 回 `file:./dev.db`
3. 改 `src/lib/db.ts` 回 `PrismaLibSql`
4. `npx prisma migrate dev` 让 Prisma 重置 schema

---

## 文件清单

```
docker-compose.yml              # Postgres 服务定义
scripts/postgres-init.sql      # 容器首次启动时的扩展初始化
scripts/migrate-sqlite-to-postgres.cjs  # 数据迁移脚本
postgres-start.bat              # 一键启动
postgres-stop.bat               # 一键停止
postgres-reset.bat              # 一键清空重建
.env / .env.local               # DATABASE_URL 已指向 Postgres
prisma/schema.prisma            # provider 改为 postgresql
src/lib/db.ts                   # PrismaLibSql → PrismaPg (待手动改)
POSTGRES_MIGRATION.md           # 本文件
```