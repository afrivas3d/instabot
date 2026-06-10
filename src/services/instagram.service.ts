import { getEnv } from '../config/env.js';
import type { InstagramSendMessageResponse, InstagramUserProfile } from '../types/instagram.types.js';
import type { MessageButton } from '../types/keyword.types.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const API_BASE = 'https://graph.instagram.com/v21.0';

export async function sendTextDM(
  recipientId: string,
  text: string,
): Promise<InstagramSendMessageResponse> {
  const env = getEnv();
  logger.debug({ recipientId }, 'Sending text DM');
  return withRetry<InstagramSendMessageResponse>(() =>
    fetch(`${API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: { text },
      }),
    }),
  );
}

export async function sendButtonDM(
  recipientId: string,
  text: string,
  buttons: MessageButton[],
): Promise<InstagramSendMessageResponse> {
  const env = getEnv();
  logger.debug({ recipientId, buttonCount: buttons.length }, 'Sending button DM');
  return withRetry<InstagramSendMessageResponse>(() =>
    fetch(`${API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: text,
                  buttons: buttons.map((b) => ({
                    type: b.type,
                    title: b.title,
                    url: b.url,
                    payload: b.payload,
                  })),
                },
              ],
            },
          },
        },
      }),
    }),
  );
}

export async function sendTextReplyToComment(
  commentId: string,
  text: string,
): Promise<InstagramSendMessageResponse> {
  const env = getEnv();
  logger.debug({ commentId }, 'Sending text reply to comment');
  return withRetry<InstagramSendMessageResponse>(() =>
    fetch(`${API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: { text },
      }),
    }),
  );
}

export async function sendButtonReplyToComment(
  commentId: string,
  text: string,
  buttons: MessageButton[],
): Promise<InstagramSendMessageResponse> {
  const env = getEnv();
  logger.debug({ commentId, buttonCount: buttons.length }, 'Sending button reply to comment');
  return withRetry<InstagramSendMessageResponse>(() =>
    fetch(`${API_BASE}/me/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        recipient: { comment_id: commentId },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: [
                {
                  title: text,
                  buttons: buttons.map((b) => ({
                    type: b.type,
                    title: b.title,
                    url: b.url,
                    payload: b.payload,
                  })),
                },
              ],
            },
          },
        },
      }),
    }),
  );
}

export async function getMediaOwner(mediaId: string): Promise<{ id: string; username: string } | null> {
  const env = getEnv();
  try {
    const response = await fetch(
      `${API_BASE}/${mediaId}?fields=owner{id,username}`,
      {
        headers: {
          Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
        },
      },
    );
    if (!response.ok) {
      logger.warn({ mediaId, status: response.status }, 'Failed to get media owner');
      return null;
    }
    const data = (await response.json()) as { owner?: { id: string; username: string } };
    return data.owner ?? null;
  } catch {
    return null;
  }
}

export async function getUserProfile(userId: string): Promise<InstagramUserProfile> {
  const env = getEnv();
  return withRetry<InstagramUserProfile>(() =>
    fetch(`${API_BASE}/${userId}?fields=id,username,name`, {
      headers: {
        Authorization: `Bearer ${env.INSTAGRAM_PAGE_ACCESS_TOKEN}`,
      },
    }),
  );
}
