# 迁移与数据库安全 SOP

## 致命坑:`prisma migrate dev` 会清空数据

**事故**:2026-08-26 凌晨,执行 `npx prisma migrate dev --name add_image_derivation` 时,
虽然本次 migration 只是 ALTER TABLE ADD COLUMN(本应保留数据),但 Prisma 在 SQLite 上做迁移
会先 drop 所有表再重建 → **User / Conversation / Message / GeneratedImage / ApiKey 全部清空**。

表现:登录时提示"邮箱或密码错误"(因为 user 表空了)。

## 规则:今后 schema 变更,严格按这个流程

### 1. 生成 SQL 但不执行

```bash
npx prisma migrate dev --name <name> --create-only
```

这会生成 `prisma/migrations/<timestamp>_<name>/migration.sql` 但**不应用到数据库**。

### 2. 人工审查 SQL

打开生成的 `.sql`,确认:
- 没有 `DROP TABLE`
- 没有 `CREATE TABLE` 覆盖已有表(除非确实是新表)
- 字段增改用 `ALTER TABLE ADD COLUMN` / `DROP COLUMN`

### 3. 备份 dev.db 后再应用

```bash
Copy-Item dev.db dev.db.before-<date> -Force
npx prisma migrate deploy
```

### 4. dev.db 数据恢复方法

如果数据真的被清了:
1. 找最近的 `dev.db.before-*` 备份
2. 或找 Windows 端的 `D:\xiaz\项目表\chatchat\aichatt (2)\aichatt\aichatt\dev.db` 这类
   "上一份工作区" 的 db(用户偶尔会留副本)
3. 备份当前空 db,再用 sqlite 直接拷贝 User/ApiKey 行到新 db
4. 再 `prisma migrate deploy` 把缺的迁移补上(ADD COLUMN 不会清数据)

### 5. 禁止

- 在没有备份的情况下跑 `prisma migrate dev`
- 用 `prisma db push` 替代 migrations(同样会重建表)
- `rm dev.db` 后不告诉用户

## 工具脚本参考

清理临时检查脚本(查 db 内容用),用完记得删:

```bash
node -e "const D=require('better-sqlite3');const db=new D('dev.db');console.log(db.prepare('SELECT count(*) as n FROM User').get().n)"
```

完整表统计模板(写到文件后 node 跑,避免 powershell 转义问题):

```js
const Database = require('better-sqlite3')
const db = new Database('dev.db')
db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().forEach(r => {
  const n = db.prepare('SELECT count(*) as n FROM "' + r.name + '"').get().n
  console.log(r.name, n)
})
```
