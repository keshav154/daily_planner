import { Router, Response } from 'express';
import { User } from '../models/Schemas';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { sendTelegramMessage, getLatestTelegramChatId, isTelegramConfigured } from '../services/telegramNotifier';
import { buildDailyBriefing } from '../services/briefingService';

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

export default router;
