import { Router, Request, Response } from 'express';
import { User } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendTelegramMessage, answerCallbackQuery, getLatestTelegramChatId, isTelegramConfigured, registerTelegramWebhook, getTelegramWebhookInfo } from '../services/telegramNotifier';
import { buildDailyBriefing } from '../services/briefingService';
import { processAgentMessage } from '../services/agentChatService';
import { handleTelegramCallback } from '../services/telegramInteractions';
import { gradeStudyReply } from '../services/studyDrip';
import { runHygieneSweep } from '../services/taskHygiene';

const router = Router();

// GET /api/notifications/telegram/status — is the bot configured, is this user connected
router.get('/telegram/status', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    res.json({
      botConfigured: isTelegramConfigured(),
      connected: !!user?.telegramChatId,
      chatId: user?.telegramChatId || null
    });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to fetch Telegram status' });
  }
});

// GET /api/notifications/telegram/detect-chat-id — self-serve discovery after the
// user has messaged the bot once
router.get('/telegram/detect-chat-id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!isTelegramConfigured()) {
      return res.status(400).json({ error: 'TELEGRAM_BOT_TOKEN is not configured on the server.' });
    }
    const found = await getLatestTelegramChatId();
    if (!found) {
      return res.status(404).json({ error: 'No messages found. Send your bot any message on Telegram first, then try again.' });
    }
    res.json(found);
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to detect chat ID' });
  }
});

// PUT /api/notifications/telegram — save the chat ID to the user's profile
router.put('/telegram', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { chatId } = req.body;
    if (!chatId) return res.status(400).json({ error: 'chatId is required' });

    const user = await User.findByIdAndUpdate(
      req.userId,
      { telegramChatId: String(chatId) },
      { new: true }
    );
    res.json({ connected: true, chatId: user?.telegramChatId });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to save Telegram connection' });
  }
});

// DELETE /api/notifications/telegram — disconnect
router.delete('/telegram', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    await User.findByIdAndUpdate(req.userId, { $unset: { telegramChatId: '' } });
    res.json({ connected: false });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to disconnect Telegram' });
  }
});

// POST /api/notifications/telegram/test — send today's briefing right now,
// so the user can verify the connection without waiting for the morning cycle
router.post('/telegram/test', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const user = await User.findById(req.userId);
    if (!user?.telegramChatId) {
      return res.status(400).json({ error: 'Connect Telegram first (save a chat ID).' });
    }

    const { briefing } = await buildDailyBriefing(req.userId!);
    const sent = await sendTelegramMessage(user.telegramChatId, `🧠 Kortex Test Message\n\n${briefing}`);

    if (!sent) {
      return res.status(502).json({ error: 'Telegram API rejected the message. Double-check the bot token and chat ID.' });
    }
    res.json({ sent: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to send test message' });
  }
});

// GET /api/notifications/telegram/webhook-info — diagnose why inbound isn't
// working. Reports what Telegram thinks the webhook is (URL, queued updates,
// last delivery error) plus whether the server has the secret configured.
router.get('/telegram/webhook-info', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const info = await getTelegramWebhookInfo();
    res.json({
      secretConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      publicUrlConfigured: !!(process.env.RENDER_EXTERNAL_URL || process.env.TELEGRAM_WEBHOOK_URL),
      telegram: info
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch webhook info' });
  }
});

// POST /api/notifications/telegram/register-webhook — force (re)registration
// without a full redeploy, e.g. right after setting TELEGRAM_WEBHOOK_SECRET.
router.post('/telegram/register-webhook', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const result = await registerTelegramWebhook();
    res.status(result.ok ? 200 : 400).json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to register webhook' });
  }
});

// POST /api/notifications/telegram/webhook — inbound replies from Telegram.
// Called by Telegram itself (not the browser), so it's authenticated via the
// shared secret Telegram echoes back on every request instead of a JWT.
// This is what turns Telegram from a one-way digest into a real capture
// channel: replying to the bot runs the exact same reasoning as the chat
// panel and capture.html (processAgentMessage), one-shot, no history.
router.post('/telegram/webhook', async (req: Request, res: Response) => {
  try {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (!secret || incomingSecret !== secret) {
      return res.status(401).json({ error: 'Invalid webhook secret' });
    }

    // Button taps arrive as callback_query updates, not messages. Handle those
    // first: run the mapped action, acknowledge the tap, and confirm.
    const callback = req.body?.callback_query;
    if (callback) {
      const cbChatId = callback.message?.chat?.id;
      const cbUser = cbChatId ? await User.findOne({ telegramChatId: String(cbChatId) }) : null;
      if (cbUser) {
        const confirmation = await handleTelegramCallback(cbUser._id.toString(), String(callback.data || ''));
        await answerCallbackQuery(callback.id, confirmation);
        await sendTelegramMessage(String(cbChatId), confirmation);
      } else {
        await answerCallbackQuery(callback.id);
      }
      return res.status(200).json({ ok: true });
    }

    const chatId = req.body?.message?.chat?.id;
    const text = req.body?.message?.text;
    if (!chatId || !text) {
      // Non-text update (photo, edited message, sticker, etc.) — nothing to do.
      return res.status(200).json({ ok: true });
    }

    const user = await User.findOne({ telegramChatId: String(chatId) });
    if (!user) {
      await sendTelegramMessage(String(chatId), 'This chat isn\'t connected to a Kortex account yet — open the app and connect Telegram from the sidebar first.');
      return res.status(200).json({ ok: true });
    }

    const userIdStr = user._id.toString();

    // If a daily study question is open, this reply is the answer — grade it
    // instead of treating it as a generic capture.
    const grading = await gradeStudyReply(userIdStr, text);
    if (grading) {
      await sendTelegramMessage(String(chatId), grading);
      return res.status(200).json({ ok: true });
    }

    // On-demand hygiene sweep via a short command word.
    if (/^(cleanup|clean up|hygiene|tidy)\b/i.test(text.trim())) {
      const swept = await runHygieneSweep(userIdStr, String(chatId));
      if (!swept) {
        await sendTelegramMessage(String(chatId), '🧹 Nothing looks stale right now — your task list is clean.');
      }
      return res.status(200).json({ ok: true });
    }

    const result = await processAgentMessage(userIdStr, text, [], 'telegram');
    let replyText = result.response;
    if (result.suggestions.length > 0) {
      replyText += `\n\n(${result.suggestions.length} suggestion${result.suggestions.length > 1 ? 's' : ''} saved for review in the app)`;
    }
    await sendTelegramMessage(String(chatId), replyText);

    res.status(200).json({ ok: true });
  } catch (error: any) {
    console.error('[Telegram] Webhook handling failed:', error);
    // Always 200 so Telegram doesn't retry-storm a message that already failed once.
    res.status(200).json({ ok: true });
  }
});

export default router;
