-- Container init script: runs once on first start when the data volume is empty.
-- Safe to re-run later; statements are idempotent.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";