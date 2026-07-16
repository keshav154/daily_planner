import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Send, CheckCircle2, Loader2, Unlink } from 'lucide-react';

interface Status {
  botConfigured: boolean;
  connected: boolean;
  chatId: string | null;
}

/**
 * Lets the user connect their Telegram account so the morning briefing gets
 * pushed to them proactively instead of only being visible when they open
 * the app. Chat ID is discovered automatically via Telegram's getUpdates —
 * the user never has to find/type a numeric ID by hand.
 */
export const TelegramConnectWidget: React.FC = () => {
  const [status, setStatus] = useState<Status | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ text: string; isError: boolean } | null>(null);
  const [manualChatId, setManualChatId] = useState('');

  const fetchStatus = async () => {
    try {
      const res = await api.get('/notifications/telegram/status');
      setStatus(res.data);
    } catch (err) {
      console.error('Failed to fetch Telegram status:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  const saveChatId = async (chatId: string) => {
    try {
      await api.put('/notifications/telegram', { chatId });
      setMessage({ text: 'Telegram connected!', isError: false });
      fetchStatus();
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error || 'Failed to save connection.', isError: true });
    }
  };

  const handleDetect = async () => {
    setDetecting(true);
    setMessage(null);
    try {
      const res = await api.get('/notifications/telegram/detect-chat-id');
      await saveChatId(res.data.chatId);
      setMessage({ text: `Connected as ${res.data.fromName}!`, isError: false });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error || 'Could not detect chat ID.', isError: true });
    } finally {
      setDetecting(false);
    }
  };

  const handleManualSave = async () => {
    if (!manualChatId.trim()) return;
    await saveChatId(manualChatId.trim());
    setManualChatId('');
  };

  const handleTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      await api.post('/notifications/telegram/test');
      setMessage({ text: 'Test message sent — check Telegram!', isError: false });
    } catch (err: any) {
      setMessage({ text: err.response?.data?.error || 'Failed to send test message.', isError: true });
    } finally {
      setTesting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api.delete('/notifications/telegram');
      setMessage(null);
      fetchStatus();
    } catch (err) {
      console.error('Failed to disconnect Telegram:', err);
    }
  };

  if (!status) return null;

  if (!status.botConfigured) {
    return (
      <div className="px-2 py-2 text-[9px] text-neutral-600 leading-relaxed">
        Telegram push not set up yet (needs TELEGRAM_BOT_TOKEN on the server).
      </div>
    );
  }

  return (
    <div className="px-2 space-y-2">
      <p className="text-[9px] font-bold text-neutral-500 uppercase tracking-wide">Chat With Kortex</p>

      {status.connected ? (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[10px] text-emerald-400 font-semibold">
            <CheckCircle2 className="w-3.5 h-3.5" /> Telegram Connected
          </div>
          <p className="text-[9px] text-neutral-500 leading-relaxed">
            You'll get the morning briefing here — and you can reply to the bot anytime to remember something, add a task, or ask what's on your plate.
          </p>
          <div className="flex gap-1.5">
            <button
              onClick={handleTest}
              disabled={testing}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded cursor-pointer transition-colors disabled:opacity-40"
            >
              {testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Send Test
            </button>
            <button
              onClick={handleDisconnect}
              className="flex items-center justify-center gap-1 py-1.5 px-2 bg-neutral-800 hover:bg-red-900/40 text-neutral-500 hover:text-red-400 text-[10px] font-semibold rounded cursor-pointer transition-colors"
              title="Disconnect Telegram"
            >
              <Unlink className="w-3 h-3" />
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[9px] text-neutral-500 leading-relaxed">
            Message your Telegram bot any text, then tap Detect.
          </p>
          <button
            onClick={handleDetect}
            disabled={detecting}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold rounded cursor-pointer transition-colors disabled:opacity-40"
          >
            {detecting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
            Detect My Chat ID
          </button>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={manualChatId}
              onChange={(e) => setManualChatId(e.target.value)}
              placeholder="or paste chat ID"
              className="flex-1 min-w-0 px-2 py-1 text-[10px] rounded bg-neutral-900 border border-white/5 text-neutral-300 placeholder-neutral-600"
            />
            <button
              onClick={handleManualSave}
              disabled={!manualChatId.trim()}
              className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-[10px] font-semibold rounded cursor-pointer transition-colors disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      )}

      {message && (
        <p className={`text-[9px] font-semibold ${message.isError ? 'text-red-400' : 'text-emerald-400'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
};
