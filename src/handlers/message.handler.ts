import type { MetaMessagingEvent } from '../types/meta.types.js';
import { logger } from '../utils/logger.js';
import {
  getLeadByIgUserId,
  setLeadEmail,
  setLeadName,
  setLeadStatus,
  setLeadOptOut,
  findLeadsByEmail,
  upsertLead,
} from '../services/lead.service.js';
import { logDM } from '../services/dmlog.service.js';
import { sendTextDM, sendButtonDM, getUserProfile } from '../services/instagram.service.js';
import { sendCustomEmail } from '../services/email.service.js';
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

  logDM({
    igUserId: senderId,
    direction: 'inbound',
    messageType: 'text',
    content: text,
  }).catch((err) => logger.error({ err }, 'Failed to log inbound DM'));

  if (!text) return;

  try {
    const lead = await getLeadByIgUserId(senderId);

    if (lead?.opted_out) {
      logger.debug({ senderId }, 'Lead is opted out, ignoring message');
      return;
    }

    if (isOptOutMessage(text)) {
      await setLeadOptOut(senderId);
      await sendTextDM(senderId, 'Listo, no te enviaremos mas mensajes automaticos. Si cambias de opinion, escribinos de nuevo.');
      logger.info({ senderId }, 'User opted out via message');
      return;
    }

    if (lead && lead.status === 'name_pending') {
      const keywordMatch = matchKeyword(text);
      if (keywordMatch) {
        await handleKeywordDM(senderId, keywordMatch, lead);
        return;
      }
      await handleNameCollection(senderId, text);
      return;
    }

    if (lead && (lead.status === 'email_pending' || lead.status === 'email_confirming' || lead.status === 'email_reminded')) {
      const keywordMatch = matchKeyword(text);
      if (keywordMatch) {
        await handleKeywordDM(senderId, keywordMatch, lead);
        return;
      }
      await handleEmailCollection(senderId, text, lead);
      return;
    }

    const rule = matchKeyword(text);
    if (rule) {
      await handleKeywordDM(senderId, rule, lead);
      return;
    }

    logger.debug({ senderId, text }, 'No keyword match, ignoring message');
  } catch (err) {
    logger.error({ err, senderId }, 'Error handling message');
  }
}

async function handleNameCollection(senderId: string, text: string): Promise<void> {
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
  if (!EMAIL_REGEX.test(text)) {
    await sendTextDM(senderId, 'Hmm, no parece un email valido. Podes enviarmelo de nuevo?');
    return;
  }

  // Block if this email already belongs to a different IG account
  try {
    const existing = await findLeadsByEmail(text);
    const usedByAnother = existing.find((l) => l.ig_user_id !== senderId);
    if (usedByAnother) {
      logger.warn(
        { senderId, email: text, otherIgUserId: usedByAnother.ig_user_id },
        'Email already in use by another IG account, blocking',
      );
      await sendTextDM(senderId, 'Ese email ya esta registrado con otra cuenta de Instagram. Podes enviarme otro?');
      return;
    }
  } catch (err) {
    logger.error({ err }, 'Failed to check duplicate email (continuing)');
  }

  // Valid and not duplicated — save it
  await setLeadEmail(senderId, text);

  const rule = getKeywordRules().find((r) => r.id === lead.keyword_id);

  // Send the followUp resource via DM
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

  // Send custom email only if this keyword has email enabled + an HTML template
  const env = getEnv();
  if (rule?.emailEnabled && rule.emailTemplate && env.RESEND_API_KEY) {
    const username = lead.ig_username ?? 'amigo';
    try {
      await sendCustomEmail(
        text,
        `Tu link: ${rule.followUp?.buttons?.[0]?.title ?? rule.keyword}`,
        rule.emailTemplate,
        { username, name: lead.name ?? username },
      );
      await setLeadStatus(senderId, 'email_sent');
    } catch (err) {
      logger.error({ err, email: text }, 'Failed to send custom email');
      await setLeadStatus(senderId, 'email_collected');
    }
  } else {
    await setLeadStatus(senderId, 'email_collected');
  }

  logger.info({ senderId, email: text, keywordId: lead.keyword_id }, 'Email collected, followUp sent');
}

async function handleKeywordDM(
  senderId: string,
  rule: NonNullable<ReturnType<typeof matchKeyword>>,
  existingLead: Awaited<ReturnType<typeof getLeadByIgUserId>>,
): Promise<void> {
  if (isRateLimited(senderId)) {
    logger.warn({ senderId }, 'User rate limited (max DMs/hour)');
    return;
  }
  if (isOnCooldown(senderId, rule.id, rule.cooldownMinutes)) {
    logger.info({ senderId, ruleId: rule.id }, 'Skipped — user on cooldown');
    return;
  }

  let username = existingLead?.ig_username;
  if (!username) {
    try {
      const profile = await getUserProfile(senderId);
      username = profile.username;
    } catch {
      username = 'amigo';
    }
  }

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

  const renderedText = renderTemplate(rule.response.text, { username });
  if (rule.response.type === 'button' && rule.response.buttons?.length) {
    await sendButtonDM(senderId, renderedText, rule.response.buttons);
  } else {
    await sendTextDM(senderId, renderedText);
  }

  recordTrigger(senderId, rule.id);
  logDM({
    igUserId: senderId,
    direction: 'outbound',
    messageType: rule.response.type,
    keywordId: rule.id,
    content: renderedText,
  }).catch((err) => logger.error({ err }, 'Failed to log DM'));

  logger.info({ senderId, ruleId: rule.id }, 'Keyword DM sent successfully');
}
