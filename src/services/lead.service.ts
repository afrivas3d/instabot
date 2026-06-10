import { getDb } from './db.js';
import { logger } from '../utils/logger.js';

export interface Lead {
  id: number;
  ig_user_id: string;
  ig_username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  keyword_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}

export async function upsertLead(data: {
  igUserId: string;
  igUsername?: string;
  name?: string;
  email?: string;
  source?: string;
  keywordId?: string;
}): Promise<Lead> {
  const db = getDb();
  const [lead] = await db<Lead[]>`
    INSERT INTO leads (ig_user_id, ig_username, name, source, keyword_id)
    VALUES (${data.igUserId}, ${data.igUsername ?? null}, ${data.name ?? null}, ${data.source ?? null}, ${data.keywordId ?? null})
    ON CONFLICT (ig_user_id)
    DO UPDATE SET
      ig_username = COALESCE(EXCLUDED.ig_username, leads.ig_username),
      name = COALESCE(EXCLUDED.name, leads.name),
      keyword_id = COALESCE(EXCLUDED.keyword_id, leads.keyword_id),
      updated_at = NOW()
    RETURNING *
  `;
  logger.debug({ igUserId: data.igUserId, status: lead.status }, 'Lead upserted');
  return lead;
}

export async function setLeadEmail(igUserId: string, email: string): Promise<Lead> {
  const db = getDb();
  const [lead] = await db<Lead[]>`
    UPDATE leads
    SET email = ${email}, status = 'email_collected', updated_at = NOW()
    WHERE ig_user_id = ${igUserId}
    RETURNING *
  `;
  logger.info({ igUserId, email }, 'Lead email collected');
  return lead;
}

export async function setLeadName(igUserId: string, name: string): Promise<Lead> {
  const db = getDb();
  const [lead] = await db<Lead[]>`
    UPDATE leads
    SET name = ${name}, updated_at = NOW()
    WHERE ig_user_id = ${igUserId}
    RETURNING *
  `;
  logger.info({ igUserId, name }, 'Lead name collected');
  return lead;
}

export async function setLeadStatus(igUserId: string, status: string): Promise<void> {
  const db = getDb();
  await db`UPDATE leads SET status = ${status}, updated_at = NOW() WHERE ig_user_id = ${igUserId}`;
}

export async function getLeadByIgUserId(igUserId: string): Promise<Lead | null> {
  const db = getDb();
  const [lead] = await db<Lead[]>`SELECT * FROM leads WHERE ig_user_id = ${igUserId}`;
  return lead ?? null;
}

export async function getLeadsPendingEmail(): Promise<Lead[]> {
  const db = getDb();
  return db<Lead[]>`SELECT * FROM leads WHERE status = 'email_pending'`;
}

export async function getLeadsPendingEmailReminder(): Promise<Lead[]> {
  const db = getDb();
  return db<Lead[]>`
    SELECT * FROM leads
    WHERE status = 'email_pending'
    AND updated_at < NOW() - INTERVAL '10 minutes'
    AND updated_at > NOW() - INTERVAL '15 minutes'
  `;
}
