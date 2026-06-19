import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Resend } from 'resend';
import { getEnv } from '../config/env.js';
import { logger } from '../utils/logger.js';

let resend: Resend | undefined;
let templateHtml: string | undefined;

function getResend(): Resend {
  if (!resend) {
    const env = getEnv();
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
    resend = new Resend(env.RESEND_API_KEY);
  }
  return resend;
}

function getTemplate(): string {
  if (!templateHtml) {
    const filename = getEnv().WELCOME_EMAIL_TEMPLATE || 'bienvenido.html';
    const templatePath = resolve(process.cwd(), 'email-templates', filename);
    templateHtml = readFileSync(templatePath, 'utf-8');
  }
  return templateHtml;
}

export async function sendWelcomeEmail(to: string, fullName: string): Promise<void> {
  const client = getResend();
  const html = getTemplate().replace('{{1.record.full_name}}', fullName);

  const { error } = await client.emails.send({
    from: getEnv().EMAIL_FROM,
    to,
    subject: '¡Bienvenido a Golem Lab!',
    html,
  });

  if (error) {
    logger.error({ error, to }, 'Failed to send welcome email');
    throw new Error(`Resend error: ${error.message}`);
  }

  logger.info({ to, fullName }, 'Welcome email sent');
}

export async function sendResourceEmail(
  to: string,
  fullName: string,
  resourceTitle: string,
  resourceUrl: string,
): Promise<void> {
  const client = getResend();
  const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8" /><title>Tu link esta listo</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #0a0a0a; color: #ffffff; padding: 20px; margin: 0; line-height: 1.6;">
  <div style="max-width: 600px; margin: 0 auto; background: #111111; border-radius: 12px; border: 1px solid #333333; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #4CBBA7, #439B8A); color: #111111; padding: 40px 30px; text-align: center;">
      <img src="https://golemlab.ai/golem-lab-logo.png" alt="Golem Lab" style="width: 64px; height: 64px; border-radius: 12px; margin: 0 auto 20px; display: block;" />
      <h1 style="font-size: 28px; margin: 0 0 10px 0;">Hola ${fullName}!</h1>
      <p style="font-size: 18px; margin: 0;">Aca tenes lo que pediste</p>
    </div>
    <div style="padding: 40px 30px; text-align: center;">
      <p style="font-size: 16px; color: #a1a1aa; margin-bottom: 30px;">Te guardamos el link para que lo tengas siempre a mano.</p>
      <a href="${resourceUrl}" style="display: inline-block; background: linear-gradient(135deg, #4CBBA7, #439B8A); color: #000000; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 18px; box-shadow: 0 4px 20px rgba(76, 187, 167, 0.4);">${resourceTitle}</a>
      <p style="font-size: 14px; color: #6b7280; margin-top: 30px;">Cualquier duda me escribis por Instagram.</p>
    </div>
    <div style="background: #0a0a0a; padding: 20px; text-align: center; font-size: 13px; color: #6b7280; border-top: 1px solid #333333;">
      <p style="margin: 5px 0;"><strong>© 2025 Golem Lab</strong></p>
    </div>
  </div>
</body>
</html>`;

  const { error } = await client.emails.send({
    from: getEnv().EMAIL_FROM,
    to,
    subject: `Tu link: ${resourceTitle}`,
    html,
  });

  if (error) {
    logger.error({ error, to }, 'Failed to send resource email');
    throw new Error(`Resend error: ${error.message}`);
  }

  logger.info({ to, fullName, resourceTitle }, 'Resource email sent');
}

export async function sendCustomEmail(
  to: string,
  subject: string,
  html: string,
  vars: Record<string, string> = {},
): Promise<void> {
  const client = getResend();

  let renderedHtml = html;
  for (const [key, value] of Object.entries(vars)) {
    renderedHtml = renderedHtml.replaceAll(`{{${key}}}`, value);
  }

  const { error } = await client.emails.send({
    from: getEnv().EMAIL_FROM,
    to,
    subject,
    html: renderedHtml,
  });

  if (error) {
    logger.error({ error, to }, 'Failed to send custom email');
    throw new Error(`Resend error: ${error.message}`);
  }

  logger.info({ to, subject }, 'Custom email sent');
}
