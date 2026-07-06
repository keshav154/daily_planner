import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { 
  Users, Sparkles, Loader2, ShieldCheck, CheckCircle2, HelpCircle
} from 'lucide-react';

interface DebateMessage {
  agent: 'Scrum Master' | 'Productivity Coach' | 'Calendar Planner';
  message: string;
}

interface Suggestion {
  id: string;
  actionType: 'create_task' | 'reorder' | 'suggest_time_block' | 'break_down';
  description: string;
  details: Record<string, any>;
}

interface BoardroomResponse {
  debate: DebateMessage[];
  suggestions: Suggestion[];
  runId: string;
}

export const VirtualBoardroom: React.FC = () => {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  
  // Dialogue replay states
  const [fullDebate, setFullDebate] = useState<DebateMessage[]>([]);
  const [visibleDebate, setVisibleDebate] = useState<DebateMessage[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [appliedSuggestions, setAppliedSuggestions] = useState<string[]>([]);
  const [currentSpeechIndex, setCurrentSpeechIndex] = useState(-1);
  const [typingText, setTypingText] = useState('');
  const debateEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    debateEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [visibleDebate, typingText]);

  // Simulate speaking and typing out of the debate dialogue bubbles
  useEffect(() => {
    if (currentSpeechIndex < 0 || currentSpeechIndex >= fullDebate.length) {
      if (currentSpeechIndex === fullDebate.length && fullDebate.length > 0) {
        // Debate complete, display recommendations
        setTypingText('');
      }
      return;
    }

    const currentLine = fullDebate[currentSpeechIndex];
    let charIdx = 0;
    setTypingText('');

    const interval = setInterval(() => {
      setTypingText(prev => prev + currentLine.message.charAt(charIdx));
      charIdx++;

      if (charIdx >= currentLine.message.length) {
        clearInterval(interval);
        // Wait 1.5 seconds, then move to the next speech bubble
        setTimeout(() => {
          setVisibleDebate(prev => [...prev, currentLine]);
          setCurrentSpeechIndex(idx => idx + 1);
        }, 1200);
      }
    }, 15); // Fast character typing

    return () => clearInterval(interval);
  }, [currentSpeechIndex, fullDebate]);

  const handleStartDebate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim() || loading) return;

    setLoading(true);
    setRunId(null);
    setFullDebate([]);
    setVisibleDebate([]);
    setSuggestions([]);
    setAppliedSuggestions([]);
    setCurrentSpeechIndex(-1);
    setTypingText('');

    try {
      const res = await api.post('/agent/boardroom/debate', { query: query.trim() });
      const data: BoardroomResponse = res.data;
      
      setFullDebate(data.debate);
      setSuggestions(data.suggestions);
      setRunId(data.runId);
      setCurrentSpeechIndex(0);
    } catch (err: any) {
      console.error(err);
      alert('Boardroom debate connection issue: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const handleAcceptSuggestion = async (suggestionId: string) => {
    if (!runId) return;
    try {
      await api.post('/agent/action', {
        runId,
        suggestionId,
        status: 'accepted'
      });
      setAppliedSuggestions(prev => [...prev, suggestionId]);
    } catch (err) {
      console.error(err);
      alert('Failed to execute recommendation.');
    }
  };

  const agentAvatars = {
    'Scrum Master': { avatar: '📋', color: 'border-blue-500 bg-blue-500/10 text-blue-400' },
    'Productivity Coach': { avatar: '🧘', color: 'border-emerald-500 bg-emerald-500/10 text-emerald-400' },
    'Calendar Planner': { avatar: '📅', color: 'border-violet-500 bg-violet-500/10 text-violet-400' }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-gradient flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" /> Virtual AI Boardroom
          </h2>
          <p className="text-xs text-neutral-400 mt-1">
            Spawn a panel of productivity agents to debate your workload and schedule.
          </p>
        </div>
      </div>

      {/* Query Bar */}
      <form onSubmit={handleStartDebate} className="glass-panel p-4 rounded-2xl flex gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="E.g., I want to launch the beta code by next Friday. Help me organize tasks..."
          className="flex-1 px-4 py-3 rounded-xl text-xs glass-input"
          disabled={loading || currentSpeechIndex >= 0}
        />
        <button
          type="submit"
          disabled={loading || !query.trim() || currentSpeechIndex >= 0}
          className="px-5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center gap-2 cursor-pointer transition-colors disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Sparkles className="w-4 h-4" />
          )}
          Assemble Board
        </button>
      </form>

      {/* Main Boardroom Area */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Debate Loop Monitor */}
        <div className="lg:col-span-2 glass-panel rounded-2xl border border-white/5 flex flex-col h-[520px] overflow-hidden">
          <div className="px-5 py-4 border-b border-white/5 bg-neutral-950/30 flex items-center justify-between">
            <h3 className="text-xs font-bold text-neutral-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
              Live Discussion Chamber
            </h3>
            {currentSpeechIndex >= 0 && (
              <span className="text-[10px] text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-full border border-indigo-500/10 font-bold">
                Debating...
              </span>
            )}
          </div>

          <div className="flex-1 p-5 overflow-y-auto space-y-4">
            {/* Empty view */}
            {visibleDebate.length === 0 && currentSpeechIndex === -1 && !loading && (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-3">
                <Users className="w-12 h-12 text-neutral-600 stroke-[1.5]" />
                <p className="text-xs text-neutral-400 max-w-sm leading-relaxed">
                  Enter a project goal or scheduling challenge above to start a live deliberation between the Scrum Master, Productivity Coach, and Calendar Planner.
                </p>
              </div>
            )}

            {/* Render Speeches */}
            {visibleDebate.map((speech, index) => {
              const cfg = agentAvatars[speech.agent];
              return (
                <div key={index} className="flex gap-3 items-start max-w-[90%]">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 text-sm ${cfg?.color}`}>
                    {cfg?.avatar}
                  </div>
                  <div className="space-y-1">
                    <p className="text-[10px] font-bold text-neutral-400">{speech.agent}</p>
                    <div className="p-3 bg-neutral-900/50 border border-white/5 rounded-2xl rounded-tl-xs text-xs text-neutral-200 leading-relaxed">
                      {speech.message}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Currently speaking bubble */}
            {currentSpeechIndex >= 0 && currentSpeechIndex < fullDebate.length && (
              <div className="flex gap-3 items-start max-w-[90%]">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 text-sm ${agentAvatars[fullDebate[currentSpeechIndex].agent]?.color}`}>
                  {agentAvatars[fullDebate[currentSpeechIndex].agent]?.avatar}
                </div>
                <div className="space-y-1">
                  <p className="text-[10px] font-bold text-indigo-400 animate-pulse">
                    {fullDebate[currentSpeechIndex].agent} is speaking...
                  </p>
                  <div className="p-3 bg-indigo-950/20 border border-indigo-500/10 rounded-2xl rounded-tl-xs text-xs text-indigo-200 leading-relaxed">
                    {typingText}
                    <span className="w-1.5 h-3.5 bg-indigo-400 inline-block ml-1 animate-pulse"></span>
                  </div>
                </div>
              </div>
            )}
            
            <div ref={debateEndRef} />
          </div>
        </div>

        {/* Panel Suggestions consensus */}
        <div className="glass-panel rounded-2xl border border-white/5 p-5 flex flex-col h-[520px]">
          <h3 className="text-xs font-bold text-neutral-300 pb-3 border-b border-white/5 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            Consensus Resolutions
          </h3>

          <div className="flex-1 overflow-y-auto py-4 space-y-3">
            {suggestions.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center text-neutral-500 text-xs">
                <HelpCircle className="w-8 h-8 text-neutral-700 stroke-[1.5] mb-2" />
                No resolutions recommended yet.
              </div>
            )}

            {suggestions.length > 0 && currentSpeechIndex >= fullDebate.length && (
              <div className="space-y-3 animate-fadeIn">
                <p className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 rounded-xl mb-4 leading-relaxed">
                  ✓ Debate complete. The Moderator has compiled the following action suggestions:
                </p>

                {suggestions.map((s) => {
                  const isApplied = appliedSuggestions.includes(s.id);
                  return (
                    <div
                      key={s.id}
                      className={`p-3.5 rounded-xl border transition-all text-xs space-y-3 ${
                        isApplied 
                          ? 'bg-emerald-950/10 border-emerald-500/20 text-emerald-300/80' 
                          : 'bg-neutral-900/60 border-white/5 hover:border-white/10'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className={`w-5 h-5 rounded-full text-[9px] font-black flex items-center justify-center shrink-0 border mt-0.5 ${
                          isApplied ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' : 'border-neutral-700 bg-neutral-800 text-neutral-300'
                        }`}>
                          {isApplied ? '✓' : '!'}
                        </span>
                        <p className="font-semibold text-neutral-200 leading-snug">{s.description}</p>
                      </div>

                      <div className="flex justify-end gap-2 pt-2 border-t border-white/5">
                        {isApplied ? (
                          <span className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Action Executed
                          </span>
                        ) : (
                          <button
                            onClick={() => handleAcceptSuggestion(s.id)}
                            className="px-3 py-1 bg-indigo-600/30 hover:bg-indigo-600 text-indigo-300 hover:text-white font-bold text-[10px] rounded-lg transition-colors cursor-pointer"
                          >
                            Execute Recommendation
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
