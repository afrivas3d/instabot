import type { MetaMessagingEvent } from '../types/meta.types.js';
import { logger } from '../utils/logger.js';
import {
  getLeadByIgUserId,
  setLeadEmail,
  setLeadName,
  setLeadStatus,
  setLeadOptOut,
  upsertLead,
} from '../services/lead.service.js';
import { logDM } from '../services/dmlog.service.js';
import { sendTextDM, sendButtonDM, getUserProfile } from '../services/instagram.service.js';
import { sendWelcomeEmail, sendResourceEmail } from '../services/email.service.js';
import { getKeywordRules, matchKeyword } from '../services/keyword.service.js';
import { isOnCooldown, isRateLimited, recordTrigger } from '../services/cooldown.service.js';
import { renderTemplate } from '../utils/templates.js';
import { getEnv } from '../config/env.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const OPT_OUT_WORDS = ['stop', 'baja', 'no quiero mas', 'no quiero más', 'cancelar', 'unsubscribe'];

function isOptOutMessage(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return OPT_OUT_WORDS.some((word) => normalized === word || normalized.includes(word));
}

export async function handleMessage(event: MetaMessagingEvent): Promise<void> {
  const senderId = event.sender.id;
  const text = event.message?.text?.trim();
  const mid = event.message?.mid;

  logger.info({ senderId, text, mid }, 'Received DM');

  // Log inbound message
  logDM({
    igUserId: senderId,
    direction: 'inbound',
    messageType: 'text',
    content: text,
  }).catch((err) => logger.error({ err }, 'Failed to log inbound DM'));

  if (!text) return;

  try {
    const lead = await getLeadByIgUserId(senderId);

    // 0. If already opted out, ignore everything
    if (lead?.opted_out) {
      logger.debug({ senderId }, 'Lead is opted out, ignoring message');
      return;
    }

    // 0.1 Opt-out request
    if (isOptOutMessage(text)) {
      await setLeadOptOut(senderId);
      await sendTextDM(senderId, 'Listo, no te enviaremos mas mensajes automaticos. Si cambias de opinion, escribinos de nuevo.');
      logger.info({ senderId }, 'User opted out via message');
      return;
    }

    // 1. Name collection flow
    if (lead && lead.status === 'name_pending') {
      const keywordMatch = matchKeyword(text);
      if (keywordMatch) {
        await handleKeywordDM(senderId, keywordMatch, lead);
        return;
      }
      await handleNameCollection(senderId, text);
      return;
    }

    // 2. Email collection flow — but if text matches a keyword, handle as keyword instead
    if (lead && (lead.status === 'email_pending' || lead.status === 'email_confirming' || lead.status === 'email_reminded')) {
      const keywordMatch = matchKeyword(text);
      if (keywordMatch) {
        await handleKeywordDM(senderId, keywordMatch, lead);
        return;
      }
      await handleEmailCollection(senderId, text, lead);
      return;
    }

    // 3. Keyword matching (ice breakers, manual keyword DMs)
    const rule = matchKeyword(text);
    if (rule) {
      await handleKeywordDM(senderId, rule, lead);
      return;
    }

    // 4. No keyword match — do nothing. This is a normal conversation with the human.
    logger.debug({ senderId, text }, 'No keyword match, ignoring message');
  } catch (err) {
    logger.error({ err, senderId }, 'Error handling message');
  }
}

async function handleNameCollection(senderId: string, text: string): Promise<void> {
  // Basic sanity check: reject very long inputs or things that look like emails
  if (text.length > 80 || EMAIL_REGEX.test(text)) {
    await sendTextDM(senderId, 'Decime solo tu nombre porfa, asi sé como llamarte :)');
    return;
  }

  await setLeadName(senderId, text);
  await sendTextDM(senderId, `Genial ${text}! Y cual es tu correo electronico para enviarte el link?`);
  await setLeadStatus(senderId, 'email_pending');

  logger.info({ senderId, name: text }, 'Name collected, asking for email');
}

async function handleEmailCollection(
  senderId: string,
  text: string,
  lead: NonNullable<Awaited<ReturnType<typeof getLeadByIgUserId>>>,
): Promise<void> {
  if (EMAIL_REGEX.test(text)) {
    // Valid email — save it
    await setLeadEmail(senderId, text);

    // Send the followUp resource for their keyword
    const rule = getKeywordRules().find((r) => r.id === lead.keyword_id);

    if (rule?.followUp) {
      if (rule.followUp.type === 'button' && rule.followUp.buttons?.length) {
        await sendButtonDM(senderId, rule.followUp.text, rule.followUp.buttons);
      } else {
        await sendTextDM(senderId, rule.followUp.text);
      }

      logDM({
        igUserId: senderId,
        direction: 'outbound',
        messageType: 'followup',
        keywordId: rule.id,
        content: rule.followUp.text,
      }).catch(() => {});
    } else {
      await sendTextDM(senderId, 'Genial, ya quedo guardado tu email! Te vamos a enviar info pronto.');
    }

    // Send emails if Resend is configured
    const env = getEnv();
    if (env.RESEND_API_KEY) {
      const username = lead.ig_username ?? 'amigo';
      try {
        if (rule?.followUp?.buttons?.[0]?.url) {
          await sendResourceEmail(text, username, rule.followUp.buttons[0].title, rule.followUp.buttons[0].url);
        } else if (rule?.followUp?.text) {
          await sendResourceEmail(text, username, 'Tu recurso', rule.followUp.text);
        }
        await sendWelcomeEmail(text, username);
        await setLeadStatus(senderId, 'email_sent');
      } catch (err) {
        logger.error({ err, email: text }, 'Failed to send emails');
      }
    }

    logger.info({ senderId, email: text, keywordId: lead.keyword_id }, 'Email collected, followUp sent');
  } else {
    // Not a valid email — ask again
    await sendTextDM(senderId, 'Hmm, no parece un email valido. Podes enviarmelo de nuevo?');
  }
}

async function handleKeywordDM(
  senderId: string,
  rule: NonNullable<ReturnType<typeof matchKeyword>>,
  existingLead: Awaited<ReturnType<typeof getLeadByIgUserId>>,
): Promise<void> {
  // Rate limit & cooldown checks
  if (isRateLimited(senderId)) {
    logger.warn({ senderId }, 'User rate limited (max DMs/hour)');
    return;
  }
  if (isOnCooldown(senderId, rule.id, rule.cooldownMinutes)) {
    logger.info({ senderId, ruleId: rule.id }, 'Skipped — user on cooldown');
    return;
  }

  // Get username
  let username = existingLead?.ig_username;
  if (!username) {
    try {
      const profile = await getUserProfile(senderId);
      username = profile.username;
    } catch {
      username = 'amigo';
    }
  }

  // Upsert lead
  try {
    await upsertLead({
      igUserId: senderId,
      igUsername: username,
      source: 'dm',
      keywordId: rule.id,
    });
  } catch (err) {
    logger.error({ err, senderId }, 'Failed to upsert lead (continuing with DM)');
  }

  // Send keyword response
  const renderedText = renderTemplate(rule.response.text, { username });
  if (rule.response.type === 'button' && rule.response.buttons?.length) {
    await sendButtonDM(senderId, renderedText, rule.response.buttons);
  } else {
    await sendTextDM(senderId, renderedText);
  }

  // Record trigger & log
  recordTrigger(senderId, rule.id);
  logDM({
    igUserId: senderId,
    direction: 'outbound',
    messageType: rule.response.type,
    keywordId: rule.id,
    content: renderedText,
  }).catch((err) => logger.error({ err }, 'Failed to log DM'));

  // If askEmail, the response already has a postback button.
  // The postback handler will take over when the user clicks it.

  logger.info({ senderId, ruleId: rule.id }, 'Keyword DM sent successfully');
}
