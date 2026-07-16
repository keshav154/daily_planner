/**
 * Free outbound push channel using the Telegram Bot API (no cost, no card,
 * ~2 minutes to set up via @BotFather). This is how the agent reaches out
 * to the user instead of waiting for them to open the app — the morning
 * briefing gets pushed here in addition to being available in the UI.
 */

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function getBotToken(): string | null {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === 'your_telegram_bot_token_here') return null;
  return token;
}

export function isTelegramConfigured(): boolean {
  return !!getBotToken();
}

/**
 * A single tappable inline button. `callback_data` is echoed back to our
 * webhook as a callback_query when the user taps it — Telegram caps it at
 * 64 bytes, so we keep it to short "verb:id" strings (e.g. "done:<taskId>").
 */
export interface TelegramButton {
  text: string;
  callback_data: string;
}

/**
 * Sends a message to a specific chat. Returns false (rather than throwing) on
 * failure so a notification hiccup never breaks the calling background cycle.
 * Pass `buttons` (rows of tappable buttons) to attach an inline keyboard —
 * this is what turns a one-way digest into something you can act on from the
 * chat itself (complete a task, roll it forward, clean up the backlog).
 */
export async function sendTelegramMessage(
  chatId: string,
  text: string,
  buttons?: TelegramButton[][]
): Promise<boolean> {
  const token = getBotToken();
  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured; skipping send.');
    return false;
  }
  if (!chatId) return false;

  try {
    const body: any = { chat_id: chatId, text, disable_web_page_preview: true };
    if (buttons && buttons.length > 0) {
      body.reply_markup = { inline_keyboard: buttons };
    }
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error(`[Telegram] sendMessage failed (${response.status}): ${errText}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[Telegram] sendMessage request failed:', err);
    return false;
  }
}

/**
 * Acknowledges a button tap so Telegram stops showing the loading spinner on
 * the button and optionally flashes a short toast to the user. Must be called
 * within ~seconds of receiving the callback_query or Telegram marks it failed.
 */
export async function answerCallbackQuery(callbackQueryId: string, text?: string): Promise<void> {
  const token = getBotToken();
  if (!token) return;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callbackQueryId, text: text || '' })
    });
  } catch (err) {
    console.error('[Telegram] answerCallbackQuery failed:', err);
  }
}

/**
 * Registers (or re-registers) the inbound webhook with Telegram so replies
 * to the bot are POSTed to POST /api/notifications/telegram/webhook instead
 * of sitting in the getUpdates queue. Safe to call on every server boot —
 * setWebhook is idempotent, and Render restarts/redeploys this process
 * often. No-ops (with a log) if the bot token or a public URL isn't
 * resolvable, e.g. local dev without a tunnel.
 */
export async function registerTelegramWebhook(): Promise<void> {
  const token = getBotToken();
  if (!token) return;

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[Telegram] TELEGRAM_WEBHOOK_SECRET not set; skipping webhook registration (inbound replies will not work).');
    return;
  }

  const publicUrl = process.env.RENDER_EXTERNAL_URL || process.env.TELEGRAM_WEBHOOK_URL;
  if (!publicUrl) {
    console.warn('[Telegram] No public URL available (RENDER_EXTERNAL_URL/TELEGRAM_WEBHOOK_URL unset); skipping webhook registration.');
    return;
  }

  const webhookUrl = `${publicUrl.replace(/\/$/, '')}/api/notifications/telegram/webhook`;

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl, secret_token: secret })
    });
    const data: any = await response.json();
    if (!response.ok || !data.ok) {
      console.error('[Telegram] setWebhook failed:', data);
      return;
    }
    console.log(`[Telegram] Webhook registered: ${webhookUrl}`);
  } catch (err) {
    console.error('[Telegram] setWebhook request failed:', err);
  }
}

/**
 * Self-serve chat-ID discovery: the user messages the bot once (any text),
 * then this reads Telegram's getUpdates feed and returns the chat ID of the
 * most recent message — the frontend calls this so the user never has to
 * manually find their numeric chat ID.
 */
export async function getLatestTelegramChatId(): Promise<{ chatId: string; fromName: string } | null> {
  const token = getBotToken();
  if (!token) return null;

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getUpdates?limit=5`);
    if (!response.ok) return null;

    const data: any = await response.json();
    const updates: any[] = data.result || [];
    if (updates.length === 0) return null;

    const last = updates[updates.length - 1];
    const chat = last.message?.chat;
    if (!chat) return null;

    return {
      chatId: String(chat.id),
      fromName: chat.first_name || chat.username || 'Unknown'
    };
  } catch (err) {
    console.error('[Telegram] getUpdates request failed:', err);
    return null;
  }
}
