// One-off migration runner: add SearchApiKey table to existing dev.db
// without losing user data. Safe to run multiple times (idempotent).
const Database = require('better-sqlite3')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'dev.db')

function main() {
  const db = new Database(DB_PATH)
  try {
    const exists = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='SearchApiKey'`)
      .get()
    if (exists) {
      console.log('SearchApiKey table already exists, skipping.')
      return
    }

    console.log('Creating SearchApiKey table...')
    db.exec(`
      CREATE TABLE "SearchApiKey" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "engine" TEXT NOT NULL,
        "encryptedKey" TEXT NOT NULL,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME NOT NULL,
        CONSTRAINT "SearchApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
      );
      CREATE INDEX "SearchApiKey_userId_idx" ON "SearchApiKey"("userId");
      CREATE UNIQUE INDEX "SearchApiKey_userId_engine_key" ON "SearchApiKey"("userId", "engine");
    `)
    console.log('SearchApiKey table created successfully.')
  } catch (err) {
    console.error('Failed:', err.message)
    process.exitCode = 1
  } finally {
    db.close()
  }
}

main()