import { Router } from 'express';
import type { Request, Response } from 'express';
import { adminAuth } from '../middleware/adminAuth.js';
import { getAllLeads } from '../services/lead.service.js';
import { getDashboardStats } from '../services/stats.service.js';
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
