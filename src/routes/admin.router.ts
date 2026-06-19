import { Router } from 'express';
import type { Request, Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { getAllLeads } from '../services/lead.service.js';
import { getDashboardStats } from '../services/stats.service.js';
import { getDb } from '../services/db.js';
import { loadKeywordRules } from '../services/keyword.service.js';
import type { KeywordRule } from '../types/keyword.types.js';
import { logger } from '../utils/logger.js';

export const adminRouter = Router();

// Protect all /admin routes
adminRouter.use(adminAuth);

// GET /admin/stats
adminRouter.get('/stats', async (_req: Request, res: Response) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err }, 'Failed to get dashboard stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/leads
adminRouter.get('/leads', async (_req: Request, res: Response) => {
  try {
    const leads = await getAllLeads();
    res.json(leads);
  } catch (err) {
    logger.error({ err }, 'Failed to get leads');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- Keyword Rules CRUD ----------

interface KeywordRuleRow {
  id: string;
  keyword: string;
  aliases: string[];
  match_type: string;
  priority: number;
  enabled: boolean;
  cooldown_minutes: number;
  flow_type: string;
  response: KeywordRule['response'];
  follow_up: KeywordRule['followUp'] | null;
  public_reply: string[] | null;
  email_enabled: boolean;
  email_template: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToRule(row: KeywordRuleRow) {
  return {
    id: row.id,
    keyword: row.keyword,
    aliases: row.aliases ?? [],
    matchType: row.match_type,
    priority: row.priority,
    enabled: row.enabled,
    cooldownMinutes: row.cooldown_minutes,
    flowType: row.flow_type,
    response: row.response,
    followUp: row.follow_up ?? null,
    publicReply: row.public_reply ?? null,
    emailEnabled: row.email_enabled,
    emailTemplate: row.email_template ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validateRule(body: any): string | null {
  if (!body.id || typeof body.id !== 'string') return 'id is required';
  if (!body.keyword || typeof body.keyword !== 'string') return 'keyword is required';
  if (!body.response) return 'response is required';
  if (!body.flowType || !['instant', 'email_only', 'name_and_email'].includes(body.flowType)) {
    return 'flowType must be instant, email_only, or name_and_email';
  }
  if ((body.flowType === 'email_only' || body.flowType === 'name_and_email') && !body.followUp) {
    return 'followUp is required for email_only and name_and_email flows';
  }
  if (body.emailEnabled && (!body.emailTemplate || !body.emailTemplate.trim())) {
    return 'emailTemplate is required when emailEnabled is true';
  }
  return null;
}

// GET /admin/keywords
adminRouter.get('/keywords', async (_req: Request, res: Response) => {
  try {
    const db = getDb();
    const rows = await db<KeywordRuleRow[]>`
      SELECT * FROM keyword_rules ORDER BY priority ASC
    `;
    res.json(rows.map(rowToRule));
  } catch (err) {
    logger.error({ err }, 'Failed to list keyword rules');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /admin/keywords/:id
adminRouter.get('/keywords/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [row] = await db<KeywordRuleRow[]>`
      SELECT * FROM keyword_rules WHERE id = ${req.params.id}
    `;
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(rowToRule(row));
  } catch (err) {
    logger.error({ err }, 'Failed to get keyword rule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /admin/keywords
adminRouter.post('/keywords', async (req: Request, res: Response) => {
  const error = validateRule(req.body);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  try {
    const db = getDb();
    const b = req.body;

    const [existing] = await db<{ id: string }[]>`SELECT id FROM keyword_rules WHERE id = ${b.id}`;
    if (existing) {
      res.status(409).json({ error: `Keyword with id "${b.id}" already exists` });
      return;
    }

    await db`
      INSERT INTO keyword_rules (
        id, keyword, aliases, match_type, priority, enabled, cooldown_minutes,
        flow_type, response, follow_up, public_reply, email_enabled, email_template
      ) VALUES (
        ${b.id}, ${b.keyword}, ${db.json(b.aliases ?? [])}, ${b.matchType ?? 'contains'},
        ${b.priority ?? 1}, ${b.enabled ?? true}, ${b.cooldownMinutes ?? 60},
        ${b.flowType}, ${db.json(b.response)}, ${b.followUp ? db.json(b.followUp) : null},
        ${b.publicReply ? db.json(b.publicReply) : null}, ${b.emailEnabled ?? false}, ${b.emailTemplate ?? null}
      )
    `;

    await loadKeywordRules();
    logger.info({ id: b.id }, 'Keyword rule created');
    res.status(201).json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to create keyword rule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /admin/keywords/:id
adminRouter.put('/keywords/:id', async (req: Request, res: Response) => {
  const error = validateRule({ ...req.body, id: req.params.id });
  if (error) {
    res.status(400).json({ error });
    return;
  }

  try {
    const db = getDb();
    const b = req.body;

    const result = await db`
      UPDATE keyword_rules SET
        keyword = ${b.keyword},
        aliases = ${db.json(b.aliases ?? [])},
        match_type = ${b.matchType ?? 'contains'},
        priority = ${b.priority ?? 1},
        enabled = ${b.enabled ?? true},
        cooldown_minutes = ${b.cooldownMinutes ?? 60},
        flow_type = ${b.flowType},
        response = ${db.json(b.response)},
        follow_up = ${b.followUp ? db.json(b.followUp) : null},
        public_reply = ${b.publicReply ? db.json(b.publicReply) : null},
        email_enabled = ${b.emailEnabled ?? false},
        email_template = ${b.emailTemplate ?? null},
        updated_at = NOW()
      WHERE id = ${req.params.id}
    `;

    if (result.count === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await loadKeywordRules();
    logger.info({ id: req.params.id }, 'Keyword rule updated');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to update keyword rule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /admin/keywords/:id/toggle
adminRouter.patch('/keywords/:id/toggle', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const [row] = await db<{ enabled: boolean }[]>`
      SELECT enabled FROM keyword_rules WHERE id = ${req.params.id}
    `;
    if (!row) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await db`
      UPDATE keyword_rules SET enabled = ${!row.enabled}, updated_at = NOW()
      WHERE id = ${req.params.id}
    `;

    await loadKeywordRules();
    logger.info({ id: req.params.id, enabled: !row.enabled }, 'Keyword rule toggled');
    res.json({ ok: true, enabled: !row.enabled });
  } catch (err) {
    logger.error({ err }, 'Failed to toggle keyword rule');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /admin/keywords/:id
adminRouter.delete('/keywords/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const result = await db`DELETE FROM keyword_rules WHERE id = ${req.params.id}`;

    if (result.count === 0) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    await loadKeywordRules();
    logger.info({ id: req.params.id }, 'Keyword rule deleted');
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, 'Failed to delete keyword rule');
    res.status(500).json({ error: 'Internal server error' });
  }
});
