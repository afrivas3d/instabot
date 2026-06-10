import type { MetaCommentValue } from '../types/meta.types.js';
import { matchKeyword } from '../services/keyword.service.js';
import { isOnCooldown, isRateLimited, recordTrigger } from '../services/cooldown.service.js';
import {
  sendTextDM,
  sendButtonDM,
  sendTextReplyToComment,
  sendButtonReplyToComment,
  replyToComment,
} from '../services/instagram.service.js';
import { renderTemplate } from '../utils/templates.js';
import { logger } from '../utils/logger.js';
import { upsertLead } from '../services/lead.service.js';
import { logDM } from '../services/dmlog.service.js';

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  const masked = local.length <= 2 ? '*'.repeat(local.length) : local[0] + '***' + local[local.length - 1];
  return `${masked}@${domain}`;
}

export async function handleComment(comment: MetaCommentValue): Promise<void> {
  const { from, text, id: commentId } = comment;
  const userId = from.id;
  const username = from.username;

  logger.info({ userId, username, text, commentId }, 'Processing comment');

  // 1. Match against keyword rules
  const rule = matchKeyword(text);
  if (!rule) {
    logger.debug({ text }, 'No keyword match');
    return;
  }
  logger.info({ ruleId: rule.id, keyword: rule.keyword }, 'Keyword matched');

  // 2. Check rate limit
  if (isRateLimited(userId)) {
    logger.warn({ userId }, 'User rate limited (max DMs/hour)');
    return;
  }

  // 3. Check cooldown
  if (isOnCooldown(userId, rule.id, rule.cooldownMinutes)) {
    logger.info({ userId, ruleId: rule.id }, 'Skipped — user on cooldown');
    return;
  }

  // 4. Upsert lead in DB
  try {
    await upsertLead({
      igUserId: userId,
      igUsername: username,
      source: 'comment',
      keywordId: rule.id,
    });
  } catch (err) {
    logger.error({ err, userId }, 'Failed to upsert lead (continuing with DM)');
  }

  // 5. Render template
  const vars = { username };
  const renderedText = renderTemplate(rule.response.text, vars);

  // 6. Send first reply via comment_id (allowed outside 24h messaging window)
  try {
    if (rule.response.type === 'button' && rule.response.buttons?.length) {
      await sendButtonReplyToComment(commentId, renderedText, rule.response.buttons);
    } else {
      await sendTextReplyToComment(commentId, renderedText);
    }

    // 7. Record trigger & log DM
    recordTrigger(userId, rule.id);
    logDM({
      igUserId: userId,
      direction: 'outbound',
      messageType: rule.response.type,
      keywordId: rule.id,
      content: renderedText,
    }).catch((err) => logger.error({ err }, 'Failed to log DM'));

    logger.info(
      { userId, username, ruleId: rule.id, commentId },
      'DM sent successfully',
    );

    // 8. Public reply on the comment, if configured
    if (rule.publicReply?.length) {
      try {
        const randomReply = rule.publicReply[Math.floor(Math.random() * rule.publicReply.length)];
        const renderedReply = renderTemplate(randomReply, vars);
        await replyToComment(commentId, renderedReply);
        logger.info({ commentId, ruleId: rule.id }, 'Public reply posted');
      } catch (err) {
        logger.error({ err, commentId, ruleId: rule.id }, 'Failed to post public reply');
      }
    }
  } catch (err) {
    logger.error({ err, userId, ruleId: rule.id }, 'Failed to send DM');
  }
}

export async function sendFollowUp(userId: string, rule: ReturnType<typeof matchKeyword>): Promise<void> {
  if (!rule?.followUp) return;

  if (rule.followUp.type === 'button' && rule.followUp.buttons?.length) {
    await sendButtonDM(userId, rule.followUp.text, rule.followUp.buttons);
  } else {
    await sendTextDM(userId, rule.followUp.text);
  }

  logDM({
    igUserId: userId,
    direction: 'outbound',
    messageType: 'followup',
    keywordId: rule.id,
    content: rule.followUp.text,
  }).catch(() => {});
}
