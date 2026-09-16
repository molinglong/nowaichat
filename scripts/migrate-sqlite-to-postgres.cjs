#!/usr/bin/env node
/**
 * scripts/migrate-sqlite-to-postgres.cjs
 *
 * One-shot migration from the old SQLite dev.db to the new Postgres container.
 * Run with: node scripts/migrate-sqlite-to-postgres.cjs
 *
 * What it does:
 *   1. Backs up dev.db to dev.db.before-pg-migration-<timestamp>
 *   2. Connects to Postgres and ensures all migration tables exist
 *      (run prisma migrate deploy against the empty DB first)
 *   3. Reads every row from each user table in dev.db
 *   4. Writes the rows into Postgres in FK-safe order
 *   5. Prints row counts before/after so you can spot-check
 *
 * Safety:
 *   - It only INSERTs. It never DELETEs.
 *   - It never touches the Postgres _prisma_migrations table.
 *   - It refuses to run unless Postgres is reachable, so you don't silently
 *     migrate against the wrong database.
 *   - It casts SQLite 0/1 → Postgres boolean and SQLite datetime strings →
 *     Postgres timestamptz on the way in.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { Client } = require('pg');

const SQLITE_PATH = path.resolve(__dirname, '..', 'dev.db');
const BACKUP_PATH = path.resolve(
    __dirname,
    '..',
    `dev.db.before-pg-migration-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`
);

// All tables in FK-safe order. Children first, parents last.
// VerificationToken, Account, Session reference User → User must exist first.
// Messages reference Conversations → Conversations first.
// CustomModel/ImageModel/GeneratedImage/ApiKey/SearchApiKey reference User.
const TABLES = [
    'User',
    'Account',
    'Session',
    'VerificationToken',
    'ApiKey',
    'Conversation',
    'Message',
    'Memory',
    'ImageModel',
    'CustomModel',
    'SearchApiKey',
    'GeneratedImage', // references User and self (parentId)
];

// Fields that are Booleans in Prisma schema → cast 0/1 → false/true on insert.
const BOOLEAN_FIELDS = new Set([
    'memoryEnabled',
    'clarifyEnabled',
    'supportsSize',
    'supportsVision',
    'supportsFiles',
    'supportsReasoning',
]);

// Fields that are DateTime in Prisma schema → parse SQLite string → JS Date.
const DATETIME_FIELDS = new Set([
    'createdAt',
    'updatedAt',
    'expires',
    'emailVerified',
]);

// Fields that are nullable integers. Prisma Int? is just Int in Postgres.
const NULLABLE_INT_FIELDS = new Set([
    'expires_at',
    'promptTokens',
    'completionTokens',
    'styleOffset',
    'contextWindow',
]);

function loadEnv() {
    const envPath = path.resolve(__dirname, '..', '.env');
    if (!fs.existsSync(envPath)) {
        throw new Error('.env not found at project root');
    }
    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?([^"]*?)"?\s*$/i);
        if (m && !process.env[m[1]]) {
            process.env[m[1]] = m[2];
        }
    }
}

function backupSqlite() {
    if (!fs.existsSync(SQLITE_PATH)) {
        console.error(`!! SQLite file not found: ${SQLITE_PATH}`);
        console.error('   Nothing to migrate. Skipping backup.');
        return;
    }
    fs.copyFileSync(SQLITE_PATH, BACKUP_PATH);
    const stat = fs.statSync(BACKUP_PATH);
    console.log(`OK backed up dev.db -> ${path.basename(BACKUP_PATH)} (${stat.size} bytes)`);
}

function readSqliteTable(sqlite, table) {
    try {
        return sqlite.prepare(`SELECT * FROM "${table}"`).all();
    } catch (err) {
        // Table may not exist in old dev.db (e.g. very early schema) → empty.
        if (String(err.message).includes('no such table')) {
            console.log(`   (no table ${table} in SQLite, skipping)`);
            return [];
        }
        throw err;
    }
}

function coerceValue(col, value) {
    if (value === null || value === undefined) return null;

    if (BOOLEAN_FIELDS.has(col)) {
        return value === 1 || value === '1' || value === true;
    }
    if (DATETIME_FIELDS.has(col)) {
        if (typeof value === 'string') {
            const d = new Date(value);
            if (Number.isNaN(d.getTime())) return null;
            return d;
        }
        return value instanceof Date ? value : null;
    }
    if (NULLABLE_INT_FIELDS.has(col)) {
        if (value === null || value === undefined) return null;
        return Number(value);
    }
    return value;
}

async function migrateTable(client, table, rows) {
    if (rows.length === 0) {
        console.log(`   ${table}: 0 rows, skipping`);
        return 0;
    }
    const cols = Object.keys(rows[0]);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const colList = cols.map((c) => `"${c}"`).join(', ');
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0;
    for (const row of rows) {
        const values = cols.map((c) => coerceValue(c, row[c]));
        try {
            const res = await client.query(sql, values);
            inserted += res.rowCount;
        } catch (err) {
            console.error(`!! Failed to insert into ${table} row id=${row.id || '?'}:`);
            console.error(`   ${err.message}`);
            console.error(`   Values: ${JSON.stringify(values).slice(0, 200)}...`);
            // Continue with remaining rows so partial data still lands.
        }
    }
    return inserted;
}

async function getPostgresCounts(client) {
    const out = {};
    for (const t of TABLES) {
        try {
            const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${t}"`);
            out[t] = r.rows[0].n;
        } catch {
            out[t] = 0;
        }
    }
    return out;
}

async function main() {
    console.log('=== SQLite -> Postgres migration ===\n');

    if (!fs.existsSync(SQLITE_PATH)) {
        console.error(`!! dev.db not found at ${SQLITE_PATH}`);
        console.error('   If you have already migrated, ignore this error.');
        process.exit(1);
    }

    loadEnv();
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl || !dbUrl.startsWith('postgresql://')) {
        console.error(`!! DATABASE_URL is not a postgresql:// URL.`);
        console.error(`   Got: ${dbUrl}`);
        console.error('   Did you forget to update .env?');
        process.exit(1);
    }

    backupSqlite();

    const sqlite = new Database(SQLITE_PATH, { readonly: true });
    const client = new Client({ connectionString: dbUrl });

    try {
        await client.connect();
        console.log('OK connected to Postgres\n');

        // Sanity check: refuse if User table is missing → prisma migrate deploy hasn't run.
        const probe = await client.query(`SELECT to_regclass('"User"') AS exists`);
        if (!probe.rows[0].exists) {
            console.error('!! Postgres "User" table does not exist.');
            console.error('   Run: npx prisma migrate deploy');
            console.error('   Then run this script again.');
            process.exit(1);
        }

        const beforeCounts = await getPostgresCounts(client);
        console.log('Postgres row counts BEFORE:');
        for (const t of TABLES) console.log(`   ${t.padEnd(20)} ${beforeCounts[t]}`);
        console.log('');

        let totalSqlite = 0;
        let totalPg = 0;
        for (const table of TABLES) {
            const rows = readSqliteTable(sqlite, table);
            console.log(`> ${table}: ${rows.length} rows in SQLite`);
            totalSqlite += rows.length;
            const inserted = await migrateTable(client, table, rows);
            console.log(`  inserted ${inserted} into Postgres (conflicts ignored)`);
            totalPg += inserted;
        }

        const afterCounts = await getPostgresCounts(client);
        console.log('\nPostgres row counts AFTER:');
        for (const t of TABLES) console.log(`   ${t.padEnd(20)} ${afterCounts[t]}`);

        console.log(`\n=== Done. SQLite rows: ${totalSqlite}, Postgres inserts: ${totalPg} ===`);
        console.log('Note: ON CONFLICT DO NOTHING means re-running is safe.');
    } finally {
        sqlite.close();
        await client.end();
    }
}

main().catch((err) => {
    console.error('\n!! Migration failed:', err.message);
    process.exit(1);
});