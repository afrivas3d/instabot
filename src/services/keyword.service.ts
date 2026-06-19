import { getDb } from './db.js';
import type { KeywordRule } from '../types/keyword.types.js';
import { logger } from '../utils/logger.js';

let rules: KeywordRule[] = [];

interface KeywordRuleRow {
  id: string;
  keyword: string;
  aliases: string[];
  match_type: KeywordRule['matchType'];
  priority: number;
  enabled: boolean;
  cooldown_minutes: number;
  flow_type: KeywordRule['flowType'];
  response: KeywordRule['response'];
  follow_up: KeywordRule['followUp'] | null;
  public_reply: string[] | null;
  email_enabled: boolean;
  email_template: string | null;
}

function rowToRule(row: KeywordRuleRow): KeywordRule {
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
    followUp: row.follow_up ?? undefined,
    publicReply: row.public_reply ?? undefined,
    emailEnabled: row.email_enabled,
    emailTemplate: row.email_template ?? undefined,
  };
}

export async function loadKeywordRules(): Promise<KeywordRule[]> {
  const db = getDb();
  const rows = await db<KeywordRuleRow[]>`
    SELECT id, keyword, aliases, match_type, priority, enabled, cooldown_minutes,
           flow_type, response, follow_up, public_reply, email_enabled, email_template
    FROM keyword_rules
    WHERE enabled = TRUE
    ORDER BY priority ASC
  `;

  rules = rows.map(rowToRule);
  logger.info({ count: rules.length }, 'Loaded keyword rules');
  return rules;
}

export function getKeywordRules(): KeywordRule[] {
  return rules;
}

export function matchKeyword(commentText: string): KeywordRule | null {
  const text = commentText.trim();
  for (const rule of rules) {
    const keywords = [rule.keyword, ...rule.aliases];
    for (const kw of keywords) {
      if (isMatch(text, kw, rule.matchType)) {
        return rule;
      }
    }
  }
  return null;
}

function isMatch(text: string, keyword: string, matchType: KeywordRule['matchType']): boolean {
  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();

  switch (matchType) {
    case 'exact':
      return lowerText === lowerKeyword;
    case 'contains':
      return lowerText.includes(lowerKeyword);
    case 'word_boundary': {
      const escaped = lowerKeyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escaped}\\b`, 'i');
      return regex.test(text);
    }
  }
}
