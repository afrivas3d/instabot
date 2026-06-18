import express from 'express';
import type { Request, Response } from 'express';
import { loadEnv } from './config/env.js';
import { logger } from './utils/logger.js';
import { loadKeywordRules } from './services/keyword.service.js';
import { initDb } from './services/db.js';
import { startEmailReminder } from './services/reminder.service.js';
import { webhookRouter } from './webhooks/router.js';
import { adminRouter } from './routes/admin.router.js';
import path from 'node:path';

const __dirname = path.resolve();

// Load and validate env vars
const env = loadEnv();

// Load keyword rules
loadKeywordRules();

const app = express();

// Serve static files (admin dashboard)
app.use(express.static(path.join(__dirname, '..', 'public')));

// Parse JSON body and preserve raw body for signature verification
app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Health endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    version: process.env.npm_package_version ?? '1.0.0',
  });
});

// Webhook routes
app.use('/webhook', webhookRouter);

// Admin routes
app.use('/admin', adminRouter);

// Serve admin.html for /admin (in case express.static doesn't catch it)
app.get('/admin', (_req: Request, res: Response) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

// Initialize database and start server
initDb()
  .then(() => {
    startEmailReminder();
    app.listen(env.PORT, '0.0.0.0', () => {
      logger.info({ port: env.PORT, env: env.NODE_ENV }, 'GolemBot server started');
    });
  })
  .catch((err) => {
    logger.fatal({ err }, 'Failed to initialize database');
    process.exit(1);
  });

export { app };
