import React, { useState, useRef, useEffect } from 'react';
import api from '../services/api';
import { 
  Sparkles, X, Send, Loader2, Check, CornerDownRight 
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Suggestion {
  id: string;
  taskId?: string;
  actionType: 'reorder' | 'suggest_time_block' | 'break_down' | 'nudge' | 'create_task';
  description: string;
  details: Record<string, any>;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  suggestions?: Suggestion[];
  runId?: string;
  appliedSuggestions?: string[]; // IDs of suggestions applied in this message
}

interface AgentChatPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSuggestionApplied: () => void;
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({ 
  isOpen, 
  onClose, 
  onSuggestionApplied 
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: "Hello! I am your Aether Planner Agent. I can help you optimize your schedule, prioritize high energy deep work, or break down complex tasks. Try asking me: 'Reschedule my afternoon' or 'Add a high priority task to write the review document by 4pm tomorrow'."
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // Build history excluding initial prompt or format history
      const history = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await api.post('/agent/chat', {
        message: userMsg,
        history
      });

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: res.data.response,
        suggestions: res.data.suggestions,
        runId: res.data.runId,
        appliedSuggestions: []
      }]);
    } catch (err) {
      console.error('Chat error:', err);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: "I ran into an issue communicating with the AI service. Please verify your environment API keys and network connection."
      }]);
    } finally {
      setLoading(false);
    }
  };

  // Apply suggestion from chat bubble
  const handleApplySuggestion = async (msgIndex: number, suggestion: Suggestion, runId: string) => {
    try {
      await api.post('/agent/action', {
        runId,
        suggestionId: suggestion.id,
        status: 'accepted'
      });

      // Update message UI locally
      setMessages(prev => prev.map((msg, idx) => {
        if (idx === msgIndex) {
          const applied = msg.appliedSuggestions || [];
          return {
            ...msg,
            appliedSuggestions: [...applied, suggestion.id]
          };
        }
        return msg;
      }));

      onSuggestionApplied();
    } catch (err) {
      console.error('Failed to apply chat suggestion:', err);
    }
  };

  // Dismiss suggestion
  const handleDismissSuggestion = async (msgIndex: number, suggestionId: string, runId: string) => {
    try {
      await api.post('/agent/action', {
        runId,
        suggestionId,
        status: 'rejected'
      });

      // Remove suggestion from list locally
      setMessages(prev => prev.map((msg, idx) => {
        if (idx === msgIndex) {
          const filtered = msg.suggestions?.filter(s => s.id !== suggestionId) || [];
          return { ...msg, suggestions: filtered };
        }
        return msg;
      }));
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          id="agent-chat-sidebar"
          initial={{ x: '100%' }}
          animate={{ x: 0 }}
          exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed inset-y-0 right-0 w-full sm:w-[420px] bg-neutral-900 border-l border-white/5 shadow-2xl flex flex-col z-50 h-screen overflow-hidden"
        >
          {/* Panel Header */}
          <div className="p-4 border-b border-white/5 flex items-center justify-between bg-neutral-950/60 backdrop-blur-md shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <Sparkles className="w-4.5 h-4.5 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-neutral-100">Aether AI Copilot</h3>
                <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                  Active Chat Mode
                </p>
              </div>
            </div>
            <button 
              onClick={onClose}
              className="p-1 rounded-lg text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 bg-neutral-950/20">
            {messages.map((msg, index) => {
              const isAssistant = msg.role === 'assistant';
              return (
                <div 
                  key={index}
                  className={`flex flex-col max-w-[85%] ${
                    isAssistant ? 'self-start items-start' : 'self-end items-end ml-auto'
                  }`}
                >
                  <div className={`p-3.5 rounded-2xl text-xs leading-relaxed ${
                    isAssistant 
                      ? 'bg-neutral-800 text-neutral-200 rounded-tl-xs border border-white/5' 
                      : 'bg-indigo-600 text-white rounded-tr-xs shadow-lg'
                  }`}>
                    {msg.content}
                  </div>

                  {/* Recommendations renderer inside chat bubbles */}
                  {isAssistant && msg.suggestions && msg.suggestions.length > 0 && msg.runId && (
                    <div className="w-full mt-2 space-y-2">
                      {msg.suggestions.map((s) => {
                        const isApplied = msg.appliedSuggestions?.includes(s.id);
                        return (
                          <div 
                            key={s.id} 
                            className={`p-3 rounded-xl border text-[11px] space-y-2 ${
                              isApplied 
                                ? 'bg-indigo-950/20 border-indigo-500/20 text-indigo-300' 
                                : 'bg-neutral-900 border-white/5'
                            }`}
                          >
                            <p className="font-semibold">{s.description}</p>
                            
                            {s.actionType === 'break_down' && s.details.subtasks && (
                              <div className="space-y-1 pl-1 text-neutral-400">
                                {s.details.subtasks.map((st: string, idx: number) => (
                                  <div key={idx} className="flex items-center gap-1">
                                    <CornerDownRight className="w-2.5 h-2.5 text-neutral-600" />
                                    <span className="truncate">{st}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                              {isApplied ? (
                                <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                                  <Check className="w-3 h-3" /> Suggestion Applied
                                </span>
                              ) : (
                                <>
                                  <button
                                    onClick={() => handleApplySuggestion(index, s, msg.runId!)}
                                    className="px-2 py-0.5 bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 font-semibold rounded cursor-pointer transition-colors"
                                  >
                                    Accept
                                  </button>
                                  <button
                                    onClick={() => handleDismissSuggestion(index, s.id, msg.runId!)}
                                    className="px-2 py-0.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold rounded cursor-pointer transition-colors"
                                  >
                                    Dismiss
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex items-center gap-2 text-neutral-500 text-xs pl-2">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                <span>Thinking...</span>
              </div>
            )}
            
            <div ref={messagesEndRef} />
          </div>

          {/* Form input footer */}
          <form onSubmit={handleSend} className="p-4 border-t border-white/5 bg-neutral-950/60 backdrop-blur-md shrink-0 flex items-center gap-2">
            <input
              id="chat-message-input"
              type="text"
              className="flex-1 px-4 py-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
              placeholder="Ask copilot to organize your day..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
            />
            <button
              id="send-chat-message"
              type="submit"
              disabled={loading || !input.trim()}
              className="w-10 h-10 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center cursor-pointer transition-all disabled:opacity-40"
            >
              <Send className="w-4.5 h-4.5" />
            </button>
          </form>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
