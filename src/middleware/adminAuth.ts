import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const env = getEnv();
  const key = req.headers['x-admin-key'] as string | undefined;

  if (!key || key !== env.ADMIN_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}
