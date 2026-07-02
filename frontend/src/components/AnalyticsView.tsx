import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { Sparkles, BookOpen, Clock, CheckCircle2, TrendingUp } from 'lucide-react';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, 
  BarChart, Bar, PieChart, Pie, Cell, Legend 
} from 'recharts';

interface Log {
  _id: string;
  duration: number;
  timestamp: string;
}

interface Task {
  _id: string;
  status: string;
  priority: string;
  category: string;
}

export const AnalyticsView: React.FC = () => {
  const [logs, setLogs] = useState<Log[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reflectionSummary, setReflectionSummary] = useState('');
  const [reflecting, setReflecting] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchAnalyticsData = async () => {
    setLoading(true);
    try {
      const logsRes = await api.get('/logs');
      setLogs(logsRes.data);

      const tasksRes = await api.get('/tasks');
      setTasks(tasksRes.data);
    } catch (err) {
      console.error('Failed to load analytics data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalyticsData();
  }, []);

  const triggerReflection = async () => {
    setReflecting(true);
    try {
      const res = await api.post('/agent/reflect', {});
      setReflectionSummary(res.data.summary);
    } catch (err) {
      console.error('Failed to generate reflection:', err);
    } finally {
      setReflecting(false);
    }
  };

  // --- Chart 1: Focus Duration Trend (Last 7 Days) ---
  const getDailyFocusTrend = () => {
    const dailyMap: Record<string, number> = {};
    
    // Group logs by date string (YYYY-MM-DD)
    logs.forEach(log => {
      const dateStr = new Date(log.timestamp).toISOString().split('T')[0];
      dailyMap[dateStr] = (dailyMap[dateStr] || 0) + log.duration;
    });

    // Get last 7 days keys
    const data = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const displayStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      
      data.push({
        date: displayStr,
        minutes: dailyMap[dateStr] || 0
      });
    }
    return data;
  };

  // --- Chart 2: Completion Rate by Priority ---
  const getPriorityCompletionData = () => {
    const priorities = ['high', 'medium', 'low'];
    return priorities.map(prio => {
      const prioTasks = tasks.filter(t => t.priority === prio);
      const completed = prioTasks.filter(t => t.status === 'done').length;
      const rate = prioTasks.length > 0 ? Math.round((completed / prioTasks.length) * 100) : 0;
      
      return {
        priority: prio.charAt(0).toUpperCase() + prio.slice(1),
        rate,
        total: prioTasks.length
      };
    });
  };

  // --- Chart 3: Task Category Breakdown ---
  const getCategoryBreakdown = () => {
    const catMap: Record<string, number> = {};
    tasks.forEach(t => {
      catMap[t.category] = (catMap[t.category] || 0) + 1;
    });

    const colors = ['#6366f1', '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b'];
    return Object.keys(catMap).map((cat, idx) => ({
      name: cat,
      value: catMap[cat],
      color: colors[idx % colors.length]
    }));
  };

  const trendData = getDailyFocusTrend();
  const priorityData = getPriorityCompletionData();
  const categoryData = getCategoryBreakdown();

  const totalCompleted = tasks.filter(t => t.status === 'done').length;
  const totalTasksCount = tasks.length;
  const overallRate = totalTasksCount > 0 ? Math.round((totalCompleted / totalTasksCount) * 100) : 0;
  const totalLoggedMinutes = logs.reduce((acc, l) => acc + l.duration, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-extrabold text-neutral-100 tracking-tight">Analytics & Reflection</h1>
        <p className="text-sm text-neutral-400">Review focus metrics, trends, and agent reflection summaries.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <span className="text-sm text-neutral-500 animate-pulse">Loading analytics...</span>
        </div>
      ) : (
        <>
          {/* Key Stat Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="glass-panel rounded-xl p-6 shadow-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center border border-indigo-500/20">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Overall Completion</p>
                <p className="text-2xl font-black text-neutral-100 mt-1">{overallRate}%</p>
                <p className="text-[10px] text-neutral-400 mt-0.5">{totalCompleted} of {totalTasksCount} tasks</p>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-6 shadow-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center border border-blue-500/20">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Total Focus Time</p>
                <p className="text-2xl font-black text-neutral-100 mt-1">{Math.round(totalLoggedMinutes / 60)} hrs</p>
                <p className="text-[10px] text-neutral-400 mt-0.5">{totalLoggedMinutes} minutes logged</p>
              </div>
            </div>

            <div className="glass-panel rounded-xl p-6 shadow-xl flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-violet-500/10 text-violet-400 flex items-center justify-center border border-violet-500/20">
                <TrendingUp className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider">Active Logs</p>
                <p className="text-2xl font-black text-neutral-100 mt-1">{logs.length}</p>
                <p className="text-[10px] text-neutral-400 mt-0.5">Focus entries recorded</p>
              </div>
            </div>
          </div>

          {/* AI reflection trigger */}
          <div className="glass-panel rounded-xl p-6 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl pointer-events-none"></div>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-4 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400 animate-pulse" />
                <div>
                  <h3 className="text-base font-bold text-neutral-100">Daily Agent Reflection</h3>
                  <p className="text-xs text-neutral-400">Summarize today's completions and extract performance patterns.</p>
                </div>
              </div>
              <button
                id="trigger-reflect-btn"
                disabled={reflecting}
                onClick={triggerReflection}
                className="flex items-center gap-2 py-2 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-500 font-semibold text-sm text-white shadow-lg cursor-pointer transition-all disabled:opacity-50"
              >
                <BookOpen className="w-4 h-4" />
                {reflecting ? 'Reflecting...' : 'Trigger Reflection'}
              </button>
            </div>

            {reflectionSummary ? (
              <div className="p-4 bg-indigo-950/20 border border-indigo-500/10 rounded-lg text-sm text-indigo-200 leading-relaxed">
                {reflectionSummary}
              </div>
            ) : (
              <div className="py-8 text-center text-neutral-500 text-sm">
                No reflection generated yet today. Click 'Trigger Reflection' above to prompt the AI agent.
              </div>
            )}
          </div>

          {/* Charts grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Focus Duration Area */}
            <div className="glass-panel rounded-xl p-6 shadow-xl space-y-4">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Focus Duration Trend (mins)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient id="colorMinutes" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" stroke="#737373" fontSize={11} tickLine={false} />
                    <YAxis stroke="#737373" fontSize={11} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.08)', borderRadius: '8px' }}
                      labelStyle={{ color: '#d4d4d4', fontWeight: 'bold' }}
                    />
                    <Area type="monotone" dataKey="minutes" stroke="#6366f1" strokeWidth={2} fillOpacity={1} fill="url(#colorMinutes)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 2: Priority Completion Bar */}
            <div className="glass-panel rounded-xl p-6 shadow-xl space-y-4">
              <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Completion Rate by Priority (%)</h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={priorityData}>
                    <XAxis dataKey="priority" stroke="#737373" fontSize={11} tickLine={false} />
                    <YAxis stroke="#737373" fontSize={11} tickLine={false} domain={[0, 100]} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.08)', borderRadius: '8px' }}
                    />
                    <Bar dataKey="rate" fill="#3b82f6" radius={[4, 4, 0, 0]}>
                      {priorityData.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={index === 0 ? '#ef4444' : index === 1 ? '#f59e0b' : '#3b82f6'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Chart 3: Category breakdown Pie */}
            {categoryData.length > 0 && (
              <div className="glass-panel rounded-xl p-6 shadow-xl space-y-4 lg:col-span-2">
                <h3 className="text-sm font-bold text-neutral-200 uppercase tracking-wider">Task Allocation by Category</h3>
                <div className="flex flex-col md:flex-row items-center justify-around gap-6 h-64">
                  <div className="w-full md:w-1/2 h-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {categoryData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#171717', borderColor: 'rgba(255,255,255,0.08)' }} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 w-full md:w-1/2">
                    {categoryData.map((cat) => (
                      <div key={cat.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: cat.color }}></div>
                        <div>
                          <p className="text-xs font-semibold text-neutral-200">{cat.name}</p>
                          <p className="text-[10px] text-neutral-400">{cat.value} task(s) scheduled</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
