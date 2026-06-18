import postgres from 'postgres';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let sql: ReturnType<typeof postgres> | undefined;

export function getDb(): ReturnType<typeof postgres> {
  if (!sql) {
    const env = getEnv();
    sql = postgres(env.DATABASE_URL, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sql;
}

export async function initDb(): Promise<void> {
  const db = getDb();

  await db`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      ig_user_id TEXT NOT NULL,
      ig_username TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      source TEXT,
      keyword_id TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS leads_ig_user_id_idx ON leads (ig_user_id)
  `;

  await db`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS opted_out BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await db`
    CREATE TABLE IF NOT EXISTS dm_log (
      id SERIAL PRIMARY KEY,
      ig_user_id TEXT NOT NULL,
      direction TEXT NOT NULL,
      message_type TEXT,
      keyword_id TEXT,
      content TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  await db`
    CREATE INDEX IF NOT EXISTS dm_log_ig_user_id_idx ON dm_log (ig_user_id)
  `;

  logger.info('Database initialized');
}

export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end();
    sql = undefined;
  }
}
