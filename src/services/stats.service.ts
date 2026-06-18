import { getDb } from './db.js';
import { getAllLeads, getLeadCountsByKeyword } from './lead.service.js';

export interface KeywordStat {
  keyword_id: string | null;
  total: number;
  email_sent: number;
  conversion_rate: string;
}

export interface DashboardStats {
  total_leads: number;
  total_email_sent: number;
  total_opted_out: number;
  leads_last_7_days: number;
  leads_last_24h: number;
  overall_conversion_rate: string;
  by_keyword: KeywordStat[];
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDb();

  const [totals] = await db<{ total: number; email_sent: number; opted_out: number }[]>`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'email_sent')::int AS email_sent,
      COUNT(*) FILTER (WHERE opted_out = TRUE)::int AS opted_out
    FROM leads
  `;

  const [recent] = await db<{ last_7_days: number; last_24h: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS last_7_days,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h
    FROM leads
  `;

  const byKeyword = await getLeadCountsByKeyword();

  const overallRate = totals.total > 0
    ? ((totals.email_sent / totals.total) * 100).toFixed(1) + '%'
    : '0%';

  return {
    total_leads: totals.total,
    total_email_sent: totals.email_sent,
    total_opted_out: totals.opted_out,
    leads_last_7_days: recent.last_7_days,
    leads_last_24h: recent.last_24h,
    overall_conversion_rate: overallRate,
    by_keyword: byKeyword.map((k) => ({
      keyword_id: k.keyword_id ?? 'unknown',
      total: k.total,
      email_sent: k.email_sent,
      conversion_rate: k.total > 0
        ? ((k.email_sent / k.total) * 100).toFixed(1) + '%'
        : '0%',
    })),
  };
}
