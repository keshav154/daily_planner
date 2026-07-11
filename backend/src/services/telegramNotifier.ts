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
 * Sends a plain-text message to a specific chat. Returns false (rather than
 * throwing) on failure so a notification hiccup never breaks the calling
 * background cycle.
 */
export async function sendTelegramMessage(chatId: string, text: string): Promise<boolean> {
  const token = getBotToken();
  if (!token) {
    console.warn('[Telegram] TELEGRAM_BOT_TOKEN not configured; skipping send.');
    return false;
  }
  if (!chatId) return false;

  try {
    const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
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
