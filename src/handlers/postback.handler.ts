import type { MetaMessagingEvent } from '../types/meta.types.js';
import { logger } from '../utils/logger.js';
import { getLeadByIgUserId, setLeadStatus } from '../services/lead.service.js';
import { getKeywordRules } from '../services/keyword.service.js';
import { sendFollowUp, maskEmail } from './comment.handler.js';
import { sendTextDM, sendButtonDM } from '../services/instagram.service.js';
import { sendCustomEmail } from '../services/email.service.js';
import { getEnv } from '../config/env.js';

export async function handlePostback(event: MetaMessagingEvent): Promise<void> {
  const senderId = event.sender.id;
  const payload = event.postback?.payload;
  const title = event.postback?.title;

  logger.info({ senderId, title, payload }, 'Received postback');

  if (!payload) return;

  if (payload.startsWith('start_email:')) {
    await handleStartEmail(senderId, payload.replace('start_email:', ''));
  } else if (payload.startsWith('confirm_email:')) {
    await handleConfirmEmail(senderId, payload.replace('confirm_email:', ''));
  } else if (payload.startsWith('change_email:')) {
    await handleChangeEmail(senderId, payload.replace('change_email:', ''));
  }
}

async function handleStartEmail(senderId: string, keywordId: string): Promise<void> {
  try {
    const lead = await getLeadByIgUserId(senderId);
    const rule = getKeywordRules().find((r) => r.id === keywordId);

    const needsName = rule?.flowType === 'name_and_email' && !lead?.name;
    const hasUsableEmail = !!lead?.email && !needsName;

    if (hasUsableEmail) {
      const masked = maskEmail(lead!.email!);
      await sendButtonDM(senderId, `Tengo tu email ${masked}. Te mando el link ahi?`, [
        { type: 'postback', title: 'Si, mandame ahi', payload: `confirm_email:${keywordId}` },
        { type: 'postback', title: 'No, cambiar email', payload: `change_email:${keywordId}` },
      ]);
      await setLeadStatus(senderId, 'email_confirming');
    } else if (needsName) {
      await sendTextDM(senderId, 'Como te llamas?');
      await setLeadStatus(senderId, 'name_pending');
    } else {
      await sendTextDM(
        senderId,
        'Para que pueda enviarte el link, cual es tu direccion de correo electronico?',
      );
      await setLeadStatus(senderId, 'email_pending');
    }

    logger.info({ senderId, keywordId, flowType: rule?.flowType, needsName, hasUsableEmail }, 'Start email flow initiated');
  } catch (err) {
    logger.error({ err, senderId }, 'Error handling start email postback');
  }
}

async function handleConfirmEmail(senderId: string, keywordId: string): Promise<void> {
  try {
    const lead = await getLeadByIgUserId(senderId);
    if (!lead?.email) {
      logger.warn({ senderId }, 'Postback confirm but no email on file');
      return;
    }

    const rule = getKeywordRules().find((r) => r.id === keywordId) ?? null;

    // Send followUp DM with the resource
    await sendFollowUp(senderId, rule);

    // Send custom email only if this keyword has email enabled + an HTML template
    const env = getEnv();
    if (rule?.emailEnabled && rule.emailTemplate && env.RESEND_API_KEY) {
      const username = lead.ig_username ?? 'amigo';
      try {
        await sendCustomEmail(
          lead.email,
          `Tu link: ${rule.followUp?.buttons?.[0]?.title ?? rule.keyword}`,
          rule.emailTemplate,
          { username, name: lead.name ?? username },
        );
        await setLeadStatus(senderId, 'email_sent');
      } catch (err) {
        logger.error({ err }, 'Failed to send custom email after confirm');
        await setLeadStatus(senderId, 'email_collected');
      }
    } else {
      await setLeadStatus(senderId, 'email_collected');
    }

    logger.info({ senderId, keywordId, email: lead.email }, 'Email confirmed, followUp sent');
  } catch (err) {
    logger.error({ err, senderId }, 'Error handling confirm postback');
  }
}

async function handleChangeEmail(senderId: string, keywordId: string): Promise<void> {
  try {
    await sendTextDM(senderId, 'Ok! Mandame tu mejor email y te lo actualizo.');
    await setLeadStatus(senderId, 'email_pending');
    logger.info({ senderId, keywordId }, 'User wants to change email');
  } catch (err) {
    logger.error({ err, senderId }, 'Error handling change email postback');
  }
}
