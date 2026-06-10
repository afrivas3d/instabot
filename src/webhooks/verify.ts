import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

export function verifySignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!signature) {
    logger.warn('Missing X-Hub-Signature-256 header');
    res.status(401).json({ error: 'Missing signature' });
    return;
  }
  const env = getEnv();
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    logger.error('Raw body not available for signature verification');
    res.status(500).json({ error: 'Internal error' });
    return;
  }
  const expectedSignature =
    'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(rawBody).digest('hex');

  // DEBUG LOG
  logger.info({
    secretPrefix: env.META_APP_SECRET.slice(0, 6),
    secretLength: env.META_APP_SECRET.length,
    receivedSig: signature,
    receivedSigLength: signature.length,
    expectedSig: expectedSignature,
    rawBodyLength: rawBody.length,
    rawBodyStart: rawBody.toString('utf8').slice(0, 100),
    rawBodyEnd: rawBody.toString('utf8').slice(-50),
  }, 'DEBUG signature check');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length || !timingSafeEqual(sigBuffer, expectedBuffer)) {
    logger.warn('Invalid webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
    return;
  }
  next();
}

export function computeSignature(secret: string, payload: string | Buffer): string {
  return 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
}
