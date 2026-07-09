import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { 
  Sparkles, Clock, CheckCircle2, Circle, AlertCircle, 
  ChevronUp, ChevronDown, Trash2, Check, X, Tag, CornerDownRight, Zap,
  ListTodo, CalendarRange, ChevronRight, Mic, Briefcase, Home, MessageSquare
} from 'lucide-react';
import { motion } from 'framer-motion';
import { TimeBlockingGrid } from './TimeBlockingGrid';
import { PomodoroTimer } from './PomodoroTimer';
import { DailyBriefingCard } from './DailyBriefingCard';
import { SmartSchedulePanel } from './SmartSchedulePanel';

interface Task {
  _id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done' | 'skipped';
  priority: 'high' | 'medium' | 'low';
  dueDate: string;
  estimatedTime: number;
  actualTime: number;
  tags: string[];
  category: string;
  order: number;
  source: 'manual' | 'agent-suggested';
  subtasks: Array<{ title: string; completed: boolean }>;
  timeBlock?: { startTime: string; endTime: string };
}

interface Suggestion {
  id: string;
  taskId?: string;
  actionType: 'reorder' | 'suggest_time_block' | 'break_down' | 'nudge' | 'create_task';
  description: string;
  details: Record<string, any>;
}

interface AgentRun {
  _id: string;
  trigger: string;
  planOutput: {
    rationale: string;
    suggestions: Suggestion[];
  };
  actionsTaken: Array<{
    suggestionId: string;
    status: 'pending' | 'accepted' | 'rejected';
  }>;
}

export const TodayView: React.FC = () => {
  const { user, updateUser } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [lastRun, setLastRun] = useState<AgentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [nlpText, setNlpText] = useState('');
  const [nlpParsing, setNlpParsing] = useState(false);
  const [planRunning, setPlanRunning] = useState(false);
  
  // Daily Standup States
  const [standupDraft, setStandupDraft] = useState('');
  const [loadingStandup, setLoadingStandup] = useState(false);
  const [showStandup, setShowStandup] = useState(false);
  const [copiedStandup, setCopiedStandup] = useState(false);

  const fetchStandupDraft = async () => {
    setLoadingStandup(true);
    try {
      const res = await api.get('/ai/daily-standup');
      setStandupDraft(res.data.standup);
    } catch (err) {
      console.error('Failed to fetch standup:', err);
    } finally {
      setLoadingStandup(false);
    }
  };

  const handleToggleWorkMode = async () => {
    if (!user) return;
    const currentMode = user.preferences?.workMode || 'wfh';
    const newMode = currentMode === 'office' ? 'wfh' : 'office';
    
    try {
      const updatedUserRes = await api.put('/auth/me', {
        preferences: {
          ...user.preferences,
          workMode: newMode
        }
      });
      updateUser(updatedUserRes.data);
      // Refresh current planner metrics
      fetchTodayData();
    } catch (err: any) {
      console.error('Failed to toggle work location:', err);
      alert('Failed to update work mode: ' + err.message);
    }
  };
  const [listening, setListening] = useState(false);
  const [rescheduleResult, setRescheduleResult] = useState<any>(null);
  const [reschedulingTaskId, setReschedulingTaskId] = useState<string | null>(null);

  const startVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.onstart = () => setListening(true);
    recognition.onend = () => setListening(false);
    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setNlpText(transcript);
    };
    recognition.start();
  };

  // Layout View mode: 'list' or 'calendar'
  const [viewMode, setViewMode] = useState<'list' | 'calendar'>('list');

  // Expanded tasks for subtask rendering
  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});
  const [subtaskInputs, setSubtaskInputs] = useState<Record<string, string>>({});

  // Parsing Confirm Modal state
  const [parsedTask, setParsedTask] = useState<any>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Task Completion Tracker state
  const [completingTask, setCompletingTask] = useState<Task | null>(null);
  const [completionDuration, setCompletionDuration] = useState(30);
  const [completionNotes, setCompletionNotes] = useState('');

  // Date selection
  const [selectedDate, setSelectedDate] = useState(() => {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  });

  const fetchTodayData = async () => {
    setLoading(true);
    try {
      const tasksRes = await api.get(`/tasks?date=${selectedDate}`);
      setTasks(tasksRes.data);
      
      const agentRes = await api.get('/agent/last-run');
      setLastRun(agentRes.data);
    } catch (err) {
      console.error('Failed to load planner data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTodayData();

    // Listen for agent action updates from chat copilot drawer
    window.addEventListener('agent-action-applied', fetchTodayData);
    return () => {
      window.removeEventListener('agent-action-applied', fetchTodayData);
    };
  }, [selectedDate]);

  // Quick NLP add (Instant Save)
  const handleNlpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nlpText.trim()) return;
    setNlpParsing(true);
    try {
      const response = await api.post('/tasks/quick-add', {
        text: nlpText,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });
      await api.post('/tasks', response.data);
      setNlpText('');
      fetchTodayData();
    } catch (err: any) {
      console.error('NLP Parse & Save error:', err);
      alert('Failed to parse or add task: ' + (err.response?.data?.error || err.message));
    } finally {
      setNlpParsing(false);
    }
  };

  // Draft and review task details first
  const handleNlpDraftAndReview = async () => {
    if (!nlpText.trim()) return;
    setNlpParsing(true);
    try {
      const response = await api.post('/tasks/quick-add', {
        text: nlpText,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      });
      setParsedTask(response.data);
      setShowConfirmModal(true);
    } catch (err: any) {
      console.error('NLP Parse error:', err);
      alert('Failed to parse description: ' + (err.response?.data?.error || err.message));
    } finally {
      setNlpParsing(false);
    }
  };

  // Save NLP parsed task after edits
  const saveParsedTask = async () => {
    try {
      await api.post('/tasks', parsedTask);
      setShowConfirmModal(false);
      setParsedTask(null);
      setNlpText('');
      fetchTodayData();
    } catch (err) {
      console.error('Failed to save parsed task:', err);
    }
  };

  // Run Agentic loop planner
  const runAgentPlanner = async () => {
    setPlanRunning(true);
    try {
      await api.post('/agent/plan', { trigger: 'manual' });
      fetchTodayData();
    } catch (err) {
      console.error('Failed to run agent loop planner:', err);
    } finally {
      setPlanRunning(false);
    }
  };

  // Handle suggestion Actions (Accept / Reject)
  const handleSuggestionAction = async (suggestionId: string, status: 'accepted' | 'rejected') => {
    if (!lastRun) return;
    try {
      await api.post('/agent/action', {
        runId: lastRun._id,
        suggestionId,
        status
      });
      fetchTodayData();
    } catch (err) {
      console.error('Failed to resolve suggestion:', err);
    }
  };

  // Trigger task complete log dialog (1-click completion)
  const toggleTaskStatus = async (task: Task) => {
    if (task.status === 'done') {
      // Un-complete task
      try {
        await api.put(`/tasks/${task._id}`, { status: 'todo' });
        fetchTodayData();
      } catch (err: any) {
        console.error('Failed to uncomplete task:', err);
        alert('Failed to uncomplete task: ' + (err.response?.data?.error || err.message));
      }
    } else {
      // 1-Click quick complete: log work and mark task status as done in the background
      const duration = task.estimatedTime || 30;
      try {
        await api.post('/logs', {
          taskId: task._id,
          title: `Completed: ${task.title}`,
          duration: Number(duration),
          notes: 'Completed in 1-click.'
        });

        await api.put(`/tasks/${task._id}`, {
          status: 'done',
          actualTime: Number(duration)
        });

        fetchTodayData();
      } catch (err: any) {
        console.error('Failed to quick complete task:', err);
        alert('Failed to quick complete task: ' + (err.response?.data?.error || err.message));
      }
    }
  };

  // Submit task completion log
  const submitTaskCompletion = async () => {
    if (!completingTask) return;
    try {
      // 1. Log the work
      await api.post('/logs', {
        taskId: completingTask._id,
        title: `Completed: ${completingTask.title}`,
        duration: Number(completionDuration),
        notes: completionNotes
      });

      // 2. Mark task status as done
      await api.put(`/tasks/${completingTask._id}`, {
        status: 'done',
        actualTime: Number(completionDuration)
      });

      setCompletingTask(null);
      fetchTodayData();
    } catch (err: any) {
      console.error('Failed to complete task:', err);
      alert('Failed to log task completion: ' + (err.response?.data?.error || err.message));
    }
  };

  // Apply AI-suggested schedule order
  const handleApplySchedule = async (orderedIds: string[]) => {
    try {
      await api.post('/tasks/reorder', {
        orders: orderedIds.map((id, idx) => ({ id, order: idx }))
      });
      fetchTodayData();
    } catch (err: any) {
      console.error('Failed to apply schedule:', err);
      alert('Failed to apply schedule: ' + (err.response?.data?.error || err.message));
    }
  };

  // Smart reschedule a single overdue task
  const handleSmartReschedule = async (taskId: string) => {
    setReschedulingTaskId(taskId);
    try {
      const res = await api.post('/ai/smart-reschedule', { taskId });
      setRescheduleResult({ ...res.data, taskId });
    } catch (err: any) {
      alert('Failed to get reschedule suggestion: ' + (err.response?.data?.error || err.message));
      setReschedulingTaskId(null);
    }
  };

  const handleAcceptReschedule = async () => {
    if (!rescheduleResult) return;
    try {
      await api.put(`/tasks/${rescheduleResult.taskId}`, {
        dueDate: rescheduleResult.suggestedDate || rescheduleResult.newDueDate,
      });
      setRescheduleResult(null);
      setReschedulingTaskId(null);
      fetchTodayData();
    } catch (err: any) {
      alert('Failed to accept reschedule: ' + (err.response?.data?.error || err.message));
    }
  };

  // Move task order
  const moveTask = async (index: number, direction: 'up' | 'down') => {
    const newTasks = [...tasks];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newTasks.length) return;

    // Swap order property
    const temp = newTasks[index].order;
    newTasks[index].order = newTasks[targetIndex].order;
    newTasks[targetIndex].order = temp;

    // Sort again
    newTasks.sort((a, b) => a.order - b.order);
    setTasks(newTasks);

    try {
      await api.post('/tasks/reorder', {
        orders: newTasks.map((t, idx) => ({ id: t._id, order: idx }))
      });
    } catch (err) {
      console.error(err);
    }
  };

  // Delete Task
  const deleteTask = async (id: string) => {
    try {
      await api.delete(`/tasks/${id}`);
      fetchTodayData();
    } catch (err) {
      console.error(err);
    }
  };

  // Toggle subtask completion status
  const handleToggleSubtask = async (task: Task, subtaskIdx: number) => {
    const updatedSubtasks = task.subtasks.map((st: { title: string; completed: boolean }, idx: number) => 
      idx === subtaskIdx ? { ...st, completed: !st.completed } : st
    );

    try {
      await api.put(`/tasks/${task._id}`, { subtasks: updatedSubtasks });
      fetchTodayData();
    } catch (err) {
      console.error(err);
    }
  };

  // Add a subtask to a task
  const handleAddSubtask = async (e: React.FormEvent, taskId: string) => {
    e.preventDefault();
    const title = subtaskInputs[taskId]?.trim();
    if (!title) return;

    const task = tasks.find(t => t._id === taskId);
    if (!task) return;

    const updatedSubtasks = [...(task.subtasks || []), { title, completed: false }];

    try {
      await api.put(`/tasks/${taskId}`, { subtasks: updatedSubtasks });
      setSubtaskInputs(prev => ({ ...prev, [taskId]: '' }));
      fetchTodayData();
    } catch (err) {
      console.error(err);
    }
  };

  // Delete a subtask from a task
  const handleDeleteSubtask = async (taskId: string, subtaskIdx: number) => {
    const task = tasks.find(t => t._id === taskId);
    if (!task) return;

    const updatedSubtasks = task.subtasks.filter((_: any, idx: number) => idx !== subtaskIdx);

    try {
      await api.put(`/tasks/${taskId}`, { subtasks: updatedSubtasks });
      fetchTodayData();
    } catch (err) {
      console.error(err);
    }
  };

  // Focus Timer complete callback
  const handleTimerComplete = (task: any, duration: number) => {
    setCompletingTask(task);
    setCompletionDuration(duration);
    setCompletionNotes(`Completed focused sprint via Pomodoro focus timer.`);
  };

  // Filter out pending suggestions
  const pendingSuggestions = lastRun?.planOutput?.suggestions?.filter(s => {
    const action = lastRun.actionsTaken.find(a => a.suggestionId === s.id);
    return action && action.status === 'pending';
  }) || [];

  return (
    <div className="space-y-6">
      <DailyBriefingCard />

      {/* Daily Standup Card */}
      <div className="glass-panel rounded-xl p-4 shadow-md border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-600/10 text-emerald-400 flex items-center justify-center border border-emerald-500/20">
              <MessageSquare className="w-3.5 h-3.5" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Slack/Teams Standup Draft</h3>
              <p className="text-[10px] text-neutral-500 font-semibold">AI-generated status report of your SRE work</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const nextShow = !showStandup;
              setShowStandup(nextShow);
              if (nextShow && !standupDraft) {
                fetchStandupDraft();
              }
            }}
            className="px-3 py-1 bg-neutral-900 hover:bg-neutral-800 text-neutral-300 border border-white/5 font-semibold text-[10px] uppercase rounded-md cursor-pointer transition-colors"
          >
            {showStandup ? 'Collapse' : 'Generate Standup'}
          </button>
        </div>

        {showStandup && (
          <div className="pt-2 border-t border-white/5 space-y-3">
            {loadingStandup ? (
              <p className="text-xs text-neutral-500 animate-pulse py-2">Synthesizing SRE work updates...</p>
            ) : (
              <>
                <textarea
                  readOnly
                  className="w-full h-32 px-3 py-2.5 rounded-lg text-xs text-neutral-300 font-mono bg-neutral-950/40 border border-white/5 focus:outline-none resize-none leading-relaxed"
                  value={standupDraft}
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(standupDraft);
                      setCopiedStandup(true);
                      setTimeout(() => setCopiedStandup(false), 2000);
                    }}
                    className={`px-4 py-2 font-bold text-xs rounded-lg cursor-pointer transition-all duration-200 ${
                      copiedStandup 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/20'
                    }`}
                  >
                    {copiedStandup ? 'Copied to Clipboard! ✓' : 'Copy Status Message'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Header bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold text-neutral-100 tracking-tight">Today's Focus</h1>
          <p className="text-sm text-neutral-400">Organize, structure, and check off your logs.</p>
        </div>
        <div className="flex items-center gap-3">
          {/* View Mode Toggle */}
          <div className="flex bg-neutral-900 border border-white/5 rounded-lg p-0.5 select-none shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md cursor-pointer transition-all ${
                viewMode === 'list' ? 'bg-neutral-800 text-indigo-400' : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Checklist View"
            >
              <ListTodo className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`p-2 rounded-md cursor-pointer transition-all ${
                viewMode === 'calendar' ? 'bg-neutral-800 text-indigo-400' : 'text-neutral-500 hover:text-neutral-300'
              }`}
              title="Time-Blocking Calendar"
            >
              <CalendarRange className="w-4 h-4" />
            </button>
          </div>

          {/* Work Mode Toggle (Office / WFH) */}
          {user && (
            <button
              type="button"
              onClick={handleToggleWorkMode}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold uppercase transition-all duration-200 cursor-pointer ${
                user.preferences?.workMode === 'office'
                  ? 'bg-indigo-950/20 border-indigo-500/30 text-indigo-400'
                  : 'bg-neutral-900/60 border-white/5 hover:border-white/10 text-neutral-400'
              }`}
              title="Toggle current work environment"
            >
              {user.preferences?.workMode === 'office' ? (
                <>
                  <Briefcase className="w-3.5 h-3.5 text-indigo-400" />
                  Office Day
                </>
              ) : (
                <>
                  <Home className="w-3.5 h-3.5 text-neutral-500" />
                  WFH Day
                </>
              )}
            </button>
          )}

          <input
            id="date-select"
            type="date"
            className="px-3 py-2 rounded-lg text-sm text-neutral-200 glass-input cursor-pointer"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
          <button
            id="run-agent-btn"
            disabled={planRunning}
            onClick={runAgentPlanner}
            className="flex items-center gap-2 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg cursor-pointer transition-all disabled:opacity-50"
          >
            <Sparkles className={`w-4 h-4 ${planRunning ? 'animate-spin' : ''}`} />
            {planRunning ? 'Analyzing...' : 'Run Agent Planner'}
          </button>
        </div>
      </div>

      {/* NLP Quick Add Bar */}
      <form onSubmit={handleNlpSubmit} className="relative">
        <div className="relative">
          <span className="absolute inset-y-0 left-0 pl-4 flex items-center text-indigo-400">
            <Zap className="w-5 h-5 animate-pulse" />
          </span>
          <input
            id="nlp-input"
            type="text"
            className="w-full pl-11 pr-56 py-4 rounded-xl text-base text-neutral-100 placeholder-neutral-500 glass-input"
            placeholder="Type a task in plain English (e.g. 'draft design doc by tomorrow 3pm, high priority, #project')..."
            value={nlpText}
            onChange={(e) => setNlpText(e.target.value)}
            disabled={nlpParsing}
          />
          <button
            type="button"
            onClick={startVoiceInput}
            className={`absolute right-[180px] top-2 py-2 px-2.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center ${
              listening 
                ? 'bg-red-500/20 border-red-500/30 text-red-400 animate-pulse' 
                : 'bg-neutral-800 hover:bg-neutral-700 border-white/5 text-neutral-400 hover:text-neutral-200'
            }`}
            title="Speech-to-Text Input"
          >
            <Mic className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={handleNlpDraftAndReview}
            disabled={nlpParsing || !nlpText.trim()}
            className="absolute right-[96px] top-2 py-2 px-3 bg-neutral-900/60 hover:bg-neutral-800 text-indigo-400 font-semibold text-xs rounded-lg cursor-pointer border border-indigo-500/20 transition-colors disabled:opacity-40"
            title="Draft and Review task details before saving"
          >
            Review ✨
          </button>
          <button
            id="nlp-submit-btn"
            type="submit"
            disabled={nlpParsing || !nlpText.trim()}
            className="absolute right-2 top-2 py-2 px-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-xs rounded-lg cursor-pointer transition-colors disabled:opacity-40"
          >
            {nlpParsing ? 'Parsing...' : 'Quick Add'}
          </button>
        </div>
      </form>

      {/* Grid container: Task list + suggestions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Task List (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          {viewMode === 'calendar' ? (
            <TimeBlockingGrid tasks={tasks} onTaskUpdated={fetchTodayData} />
          ) : (
            <div className="glass-panel rounded-xl p-6 shadow-xl">
              <div className="flex items-center justify-between mb-4 border-b border-white/5 pb-3">
                <h2 className="text-lg font-bold text-neutral-100">Tasks Checklist</h2>
                <span className="text-xs text-neutral-400 font-semibold bg-neutral-900 px-2 py-1 rounded-md">
                  {tasks.filter(t => t.status === 'done').length} / {tasks.length} Completed
                </span>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <span className="text-sm text-neutral-500 animate-pulse">Loading checklist...</span>
                </div>
              ) : tasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-16 text-neutral-500 space-y-3">
                  <CheckCircle2 className="w-12 h-12 stroke-[1.25] text-neutral-600" />
                  <div>
                    <p className="text-base font-semibold">No tasks scheduled for today</p>
                    <p className="text-xs">Add one above using the natural language bar.</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-white/5">
                  {/* Smart Schedule Panel */}
                  <div className="pb-3 mb-1">
                    <SmartSchedulePanel tasks={tasks} onApplySchedule={handleApplySchedule} />
                  </div>
                  {tasks.map((task, index) => (
                    <motion.div
                      key={task._id}
                      layout
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="py-4 border-b border-white/5 last:border-b-0 space-y-3"
                    >
                      <div className="flex items-start justify-between group">
                        <div className="flex items-start gap-3 flex-1 min-w-0 pr-4">
                          <button
                            type="button"
                            onClick={() => setExpandedTasks(prev => ({ ...prev, [task._id]: !prev[task._id] }))}
                            className="mt-1 text-neutral-500 hover:text-neutral-300 cursor-pointer transition-colors"
                          >
                            <ChevronRight className={`w-3.5 h-3.5 transform transition-transform ${expandedTasks[task._id] ? 'rotate-90' : ''}`} />
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleTaskStatus(task)}
                            className="mt-0.5 text-neutral-500 hover:text-indigo-400 cursor-pointer transition-colors focus:outline-none"
                          >
                            {task.status === 'done' ? (
                              <CheckCircle2 className="w-5 h-5 text-emerald-500 fill-emerald-500/10" />
                            ) : (
                              <Circle className="w-5 h-5" />
                            )}
                          </button>
                          
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold text-neutral-200 truncate ${task.status === 'done' ? 'line-through text-neutral-500' : ''}`}>
                              {task.title}
                            </p>
                            {task.description && (
                              <p className="text-xs text-neutral-400 mt-1 line-clamp-2">
                                {task.description}
                              </p>
                            )}
                            <div className="flex flex-wrap items-center gap-2 mt-2">
                              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                task.priority === 'high' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                                task.priority === 'medium' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                                {task.priority}
                              </span>
                              <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5 flex items-center gap-1">
                                <Clock className="w-3 h-3" /> {task.estimatedTime}m
                              </span>
                              {task.actualTime > 0 && (
                                <span className="text-[10px] text-emerald-400 bg-emerald-950/20 px-2 py-0.5 rounded border border-emerald-500/10">
                                  Logged: {task.actualTime}m
                                </span>
                              )}
                              {task.category && (
                                <span className="text-[10px] text-neutral-400 bg-neutral-900 px-2 py-0.5 rounded border border-white/5 flex items-center gap-1">
                                  <Tag className="w-3 h-3" /> {task.category}
                                </span>
                              )}
                              {task.source === 'agent-suggested' && (
                                <span className="text-[10px] text-indigo-400 bg-indigo-950/20 px-2 py-0.5 rounded border border-indigo-500/10 flex items-center gap-0.5 font-medium">
                                  <Sparkles className="w-2.5 h-2.5" /> AI
                                </span>
                              )}
                              {task.timeBlock?.startTime && (
                                <span className="text-[10px] text-indigo-400 bg-indigo-950/20 px-2 py-0.5 rounded border border-indigo-500/10 flex items-center gap-1 font-semibold">
                                  <Clock className="w-3.5 h-3.5 text-neutral-500" /> {task.timeBlock.startTime} - {task.timeBlock.endTime}
                                </span>
                              )}
                              {/* Overdue Smart Reschedule chip */}
                              {task.dueDate && new Date(task.dueDate) < new Date(selectedDate) && task.status !== 'done' && (
                                <button
                                  type="button"
                                  onClick={() => handleSmartReschedule(task._id)}
                                  disabled={reschedulingTaskId === task._id}
                                  className="text-[10px] text-amber-400 bg-amber-950/20 px-2 py-0.5 rounded border border-amber-500/20 flex items-center gap-1 font-semibold cursor-pointer hover:bg-amber-500/10 transition-colors disabled:opacity-50"
                                >
                                  {reschedulingTaskId === task._id ? (
                                    <span className="animate-pulse">Rescheduling...</span>
                                  ) : (
                                    <><Sparkles className="w-2.5 h-2.5" /> Smart Reschedule</>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={() => {
                              setCompletingTask(task);
                              setCompletionDuration(task.estimatedTime || 30);
                              setCompletionNotes('');
                            }}
                            className="p-1 rounded text-neutral-400 hover:text-emerald-400 hover:bg-neutral-800 cursor-pointer transition-colors"
                            title="Log Work & Notes"
                          >
                            <Clock className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveTask(index, 'up')}
                            className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronUp className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            disabled={index === tasks.length - 1}
                            onClick={() => moveTask(index, 'down')}
                            className="p-1 rounded text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 disabled:opacity-30 cursor-pointer"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteTask(task._id)}
                            className="p-1 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded subtask block */}
                      {expandedTasks[task._id] && (
                        <div className="pl-12 pr-6 space-y-3 pb-2">
                          {/* Progress Bar */}
                          {task.subtasks && task.subtasks.length > 0 && (
                            <div className="flex items-center gap-3">
                              <div className="flex-1 bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className="bg-indigo-500 h-full transition-all duration-300"
                                  style={{ 
                                    width: `${Math.round(
                                      (task.subtasks.filter((s: any) => s.completed).length / task.subtasks.length) * 100
                                    )}%` 
                                  }}
                                ></div>
                              </div>
                              <span className="text-[10px] text-neutral-500 font-bold tracking-wide">
                                {task.subtasks.filter((s: any) => s.completed).length}/{task.subtasks.length} Completed
                              </span>
                            </div>
                          )}

                          {/* Subtasks checklist */}
                          {task.subtasks && task.subtasks.length > 0 && (
                            <div className="space-y-2">
                              {task.subtasks.map((sub: { title: string; completed: boolean }, sIdx: number) => (
                                <div key={sIdx} className="flex items-center justify-between group/sub">
                                  <div className="flex items-center gap-2 text-xs">
                                    <button
                                      type="button"
                                      onClick={() => handleToggleSubtask(task, sIdx)}
                                      className="text-neutral-500 hover:text-indigo-400 cursor-pointer focus:outline-none"
                                    >
                                      {sub.completed ? (
                                        <CheckCircle2 className="w-3.5 h-3.5 text-indigo-400" />
                                      ) : (
                                        <Circle className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                    <span className={`text-neutral-300 ${sub.completed ? 'line-through text-neutral-600' : ''}`}>
                                      {sub.title}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSubtask(task._id, sIdx)}
                                    className="opacity-0 group-hover/sub:opacity-100 p-0.5 rounded text-neutral-500 hover:text-red-400 hover:bg-neutral-800 transition-opacity cursor-pointer"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Add subtask form */}
                          <form onSubmit={(e) => handleAddSubtask(e, task._id)} className="flex items-center gap-2">
                            <input
                              type="text"
                              placeholder="Add subtask..."
                              className="flex-1 px-2.5 py-1 rounded bg-neutral-900 border border-white/5 text-[11px] text-neutral-100 placeholder-neutral-500 focus:outline-none focus:border-indigo-500/50"
                              value={subtaskInputs[task._id] || ''}
                              onChange={(e) => setSubtaskInputs(prev => ({ ...prev, [task._id]: e.target.value }))}
                            />
                            <button
                              type="submit"
                              disabled={!subtaskInputs[task._id]?.trim()}
                              className="px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-semibold text-[10px] rounded cursor-pointer disabled:opacity-40 transition-colors"
                            >
                              Add
                            </button>
                          </form>
                        </div>
                      )}
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* AI Agent Suggestions & Focus Panel (1 col) */}
        <div className="space-y-6">
          {/* Focus Timer */}
          <PomodoroTimer tasks={tasks} onTimerComplete={handleTimerComplete} />
          <div className="glass-panel rounded-xl p-6 shadow-xl relative overflow-hidden">
            {/* Background pattern */}
            <div className="absolute top-0 right-0 w-24 h-24 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none"></div>

            <div className="flex items-center gap-2 mb-4 border-b border-white/5 pb-3">
              <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
              <h2 className="text-lg font-bold text-neutral-100">Agent Suggestions</h2>
            </div>

            {pendingSuggestions.length === 0 ? (
              <div className="flex flex-col items-center justify-center text-center py-12 text-neutral-500 space-y-2">
                <AlertCircle className="w-8 h-8 stroke-[1.25] text-neutral-600" />
                <p className="text-sm font-semibold">No suggestions currently available</p>
                <p className="text-xs max-w-[200px]">Click 'Run Agent Planner' above to query recommendations.</p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 bg-indigo-950/20 border border-indigo-500/10 rounded-lg text-xs text-indigo-300 leading-relaxed font-sans">
                  <span className="font-semibold block mb-1">Agent Rationale:</span>
                  {lastRun?.planOutput.rationale}
                </div>

                <div className="space-y-3">
                  {pendingSuggestions.map((s) => (
                    <div key={s.id} className="p-3 bg-neutral-900/60 border border-white/5 rounded-lg text-xs space-y-2">
                      <p className="font-semibold text-neutral-200">{s.description}</p>
                      
                      {/* Action specifics preview */}
                      {s.actionType === 'break_down' && s.details.subtasks && (
                        <div className="space-y-1 pl-1 py-1 text-neutral-400">
                          {s.details.subtasks.map((st: string, idx: number) => (
                            <div key={idx} className="flex items-center gap-1.5">
                              <CornerDownRight className="w-3 h-3 text-neutral-600" />
                              <span className="truncate">{st}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {s.actionType === 'suggest_time_block' && (
                        <p className="text-neutral-400">
                          Block: <span className="text-indigo-400 font-semibold">{s.details.startTime}</span> ({s.details.duration}m)
                        </p>
                      )}

                      <div className="flex items-center gap-2 pt-1.5 border-t border-white/5">
                        <button
                          onClick={() => handleSuggestionAction(s.id, 'accepted')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold rounded cursor-pointer transition-colors"
                        >
                          <Check className="w-3.5 h-3.5" /> Accept
                        </button>
                        <button
                          onClick={() => handleSuggestionAction(s.id, 'rejected')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold rounded cursor-pointer transition-colors"
                        >
                          <X className="w-3.5 h-3.5" /> Dismiss
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* NLP Parse Confirmation Modal */}
      {showConfirmModal && parsedTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg glass-panel rounded-xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400 animate-spin" />
                <h3 className="text-lg font-bold text-neutral-100">Review Parsed Task</h3>
              </div>
              <button 
                onClick={() => setShowConfirmModal(false)}
                className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Task Title</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input"
                  value={parsedTask.title}
                  onChange={(e) => setParsedTask({ ...parsedTask, title: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Priority</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg text-sm text-neutral-200 glass-input cursor-pointer"
                    value={parsedTask.priority}
                    onChange={(e) => setParsedTask({ ...parsedTask, priority: e.target.value })}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Category</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg text-sm text-neutral-200 glass-input cursor-pointer"
                    value={parsedTask.category}
                    onChange={(e) => setParsedTask({ ...parsedTask, category: e.target.value })}
                  >
                    <option value="Work">Work</option>
                    <option value="Personal">Personal</option>
                    <option value="Health">Health</option>
                    <option value="Learning">Learning</option>
                    <option value="Finance">Finance</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Duration (mins)</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input"
                    value={parsedTask.estimatedTime}
                    onChange={(e) => setParsedTask({ ...parsedTask, estimatedTime: Number(e.target.value) })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">Due Date</label>
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-2 rounded-lg text-sm text-neutral-200 glass-input cursor-pointer"
                    value={new Date(parsedTask.dueDate).toISOString().slice(0, 16)}
                    onChange={(e) => setParsedTask({ ...parsedTask, dueDate: new Date(e.target.value).toISOString() })}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <button
                onClick={() => setShowConfirmModal(false)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                id="confirm-save-task"
                onClick={saveParsedTask}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Confirm & Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Completing Task Logs overlay dialog */}
      {completingTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md glass-panel rounded-xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <h3 className="text-lg font-bold text-neutral-100">Log Task Accomplishment</h3>
              <button 
                onClick={() => setCompletingTask(null)}
                className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <p className="text-xs text-neutral-400 uppercase font-semibold tracking-wider">Task Title</p>
                <p className="text-sm font-semibold text-neutral-200 mt-1">{completingTask.title}</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  Actual Duration (minutes)
                </label>
                <input
                  type="number"
                  className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input"
                  value={completionDuration}
                  onChange={(e) => setCompletionDuration(Number(e.target.value))}
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-1.5">
                  Session Notes (optional)
                </label>
                <textarea
                  className="w-full px-3 py-2 rounded-lg text-sm text-neutral-100 glass-input h-20 resize-none"
                  placeholder="What did you get done? Any insights or roadblocks?"
                  value={completionNotes}
                  onChange={(e) => setCompletionNotes(e.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <button
                onClick={() => setCompletingTask(null)}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                id="submit-log-btn"
                onClick={submitTaskCompletion}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Log & Complete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Smart Reschedule Result Modal */}
      {rescheduleResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md glass-panel rounded-xl p-6 shadow-2xl space-y-5 border border-amber-500/20">
            <div className="flex items-center justify-between border-b border-white/5 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-amber-400" />
                <h3 className="text-lg font-bold text-neutral-100">Smart Reschedule</h3>
              </div>
              <button
                onClick={() => { setRescheduleResult(null); setReschedulingTaskId(null); }}
                className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              {rescheduleResult.recommendation && (
                <div className="p-4 bg-amber-950/20 border border-amber-500/15 rounded-lg">
                  <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1.5">AI Recommendation</p>
                  <p className="text-sm text-amber-200/80 leading-relaxed">{rescheduleResult.recommendation}</p>
                </div>
              )}
              {(rescheduleResult.suggestedDate || rescheduleResult.newDueDate) && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-neutral-400">Suggested new date:</span>
                  <span className="font-bold text-indigo-300">
                    {new Date(rescheduleResult.suggestedDate || rescheduleResult.newDueDate).toLocaleDateString('en-US', {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                  </span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-white/5">
              <button
                onClick={() => { setRescheduleResult(null); setReschedulingTaskId(null); }}
                className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-400 font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Dismiss
              </button>
              <button
                onClick={handleAcceptReschedule}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm rounded-lg cursor-pointer transition-colors"
              >
                Accept & Reschedule
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
