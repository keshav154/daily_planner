import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { TodayView } from './TodayView';
import { LogsView } from './LogsView';
import { AnalyticsView } from './AnalyticsView';
import { AgentMemoryView } from './AgentMemoryView';
import { AIToolsView } from './AIToolsView';
import { WeeklyReviewView } from './WeeklyReviewView';
import { BurnoutAlert } from './BurnoutAlert';
import { VirtualBoardroom } from './VirtualBoardroom';
import { CoPilotDashboard } from './CoPilotDashboard';
import { GoalTrackerView } from './GoalTrackerView';
import { AgentActivityFeed } from './AgentActivityFeed';
import { TelegramConnectWidget } from './TelegramConnectWidget';
import { 
  Sparkles, Calendar, BookOpen, BarChart3, LogOut, User, Menu, X, 
  CalendarDays, Heart, Copy, Repeat, Sun, Moon, Brain, BarChart2, Users, Cpu, Target
} from 'lucide-react';
import { AgentChatPanel } from './AgentChatPanel';
import { WeeklyCalendarView } from './WeeklyCalendarView';
import { HabitTrackerView } from './HabitTrackerView';
import { TaskTemplatesView } from './TaskTemplatesView';
import { RecurringEventsManager } from './RecurringEventsManager';
import { XPProgressBar } from './XPProgressBar';
import { useTheme } from '../context/ThemeContext';

type Tab = 'today' | 'logs' | 'analytics' | 'insights' | 'schedule' | 'habits' | 'templates' | 'recurring' | 'ai-tools' | 'weekly-review' | 'boardroom' | 'copilot-config' | 'goals' | 'agent-feed';

export const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<Tab>('today');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const navItems = [
    { id: 'today' as Tab, label: 'Today Planner', icon: Calendar },
    { id: 'schedule' as Tab, label: 'Weekly Schedule', icon: CalendarDays },
    { id: 'logs' as Tab, label: 'Work History', icon: BookOpen },
    { id: 'habits' as Tab, label: 'Daily Habits', icon: Heart },
    { id: 'templates' as Tab, label: 'Task Templates', icon: Copy },
    { id: 'recurring' as Tab, label: 'Recurring Rules', icon: Repeat },
    { id: 'goals' as Tab, label: 'Second Brain Goals', icon: Target },
    { id: 'agent-feed' as Tab, label: 'Agent Activity', icon: Cpu },
    { id: 'boardroom' as Tab, label: 'AI Boardroom', icon: Users },
    { id: 'copilot-config' as Tab, label: 'AI Co-pilot', icon: Cpu },
    { id: 'analytics' as Tab, label: 'Analytics', icon: BarChart3 },
    { id: 'insights' as Tab, label: 'Agent Memory', icon: Sparkles },
    { id: 'ai-tools' as Tab, label: 'AI Tools', icon: Brain },
    { id: 'weekly-review' as Tab, label: 'Weekly Review', icon: BarChart2 },
  ];

  const renderActiveView = () => {
    switch (activeTab) {
      case 'today':
        return <TodayView />;
      case 'logs':
        return <LogsView />;
      case 'analytics':
        return <AnalyticsView />;
      case 'insights':
        return <AgentMemoryView />;
      case 'schedule':
        return <WeeklyCalendarView />;
      case 'habits':
        return <HabitTrackerView />;
      case 'templates':
        return <TaskTemplatesView />;
      case 'recurring':
        return <RecurringEventsManager />;
      case 'ai-tools':
        return <AIToolsView />;
      case 'weekly-review':
        return <WeeklyReviewView />;
      case 'boardroom':
        return <VirtualBoardroom />;
      case 'copilot-config':
        return <CoPilotDashboard />;
      case 'goals':
        return <GoalTrackerView />;
      case 'agent-feed':
        return <AgentActivityFeed />;
    }
  };

  return (
    <div className="min-h-screen flex bg-neutral-950 text-neutral-100 font-sans">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 lg:hidden"
        ></div>
      )}

      {/* Sidebar navigation */}
      <aside className={`fixed inset-y-0 left-0 w-64 glass-panel border-r border-white/5 flex flex-col z-50 transition-transform duration-300 lg:translate-x-0 lg:static lg:h-screen shrink-0 pt-safe pb-safe ${
        sidebarOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {/* Brand header */}
        <div className="h-16 flex items-center justify-between px-6 border-b-4 border-black dark:border-white">
          <div className="flex items-center gap-2.5">
            <img src="/logo.svg" alt="Kortex Logo" className="w-8 h-8 select-none" />
            <span className="font-black font-sans text-sm uppercase tracking-wider text-black dark:text-neutral-100">
              KortexKeshav
            </span>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden text-neutral-400 hover:text-neutral-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation list */}
        <nav className="flex-1 px-4 py-6 space-y-1.5 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`nav-${item.id}`}
                onClick={() => {
                  setActiveTab(item.id);
                  setSidebarOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-none text-sm font-bold transition-all duration-100 cursor-pointer border ${
                  isActive 
                    ? 'bg-indigo-600 text-white border-black dark:border-white shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] dark:shadow-[2px_2px_0px_0px_rgba(255,255,255,1)] translate-x-[-1px] translate-y-[-1px]' 
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/40 border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : ''}`} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Burnout Alert */}
        <BurnoutAlert />

        {/* XP Progress Bar */}
        <XPProgressBar />

        {/* Sidebar Footer User profile */}
        <div className="p-4 border-t border-white/5 bg-neutral-900/20 space-y-3">
          <div className="flex items-center gap-3 px-2">
            <div className="w-8 h-8 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-300 border border-white/5">
              <User className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-neutral-300 truncate">{user?.email}</p>
              <p className="text-[9px] text-neutral-500 font-semibold tracking-wide uppercase">Standard Profile</p>
            </div>
          </div>

          {user?.apiKey && (
            <div className="px-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(user.apiKey || '');
                  alert('Kortex API Key copied to clipboard!');
                }}
                className="w-full py-2 px-2 bg-[#FFD93D] dark:bg-[#39ff14] text-black font-extrabold text-[10px] uppercase border-2 border-black dark:border-white rounded-none flex items-center justify-center gap-1.5 cursor-pointer shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-100"
                title="Copy Kortex API Key for CLI/Coding Agent integration"
              >
                <span>🔑 Copy API Key</span>
              </button>
            </div>
          )}

          <TelegramConnectWidget />

          <button
            id="logout-btn"
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-none text-xs font-bold text-neutral-300 hover:text-white bg-neutral-900 border-2 border-black dark:border-white cursor-pointer hover:bg-red-600 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main workspace area */}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {/* Top bar header */}
        <header className="pt-safe min-h-[4rem] border-b border-white/5 flex items-center justify-between px-6 md:px-8 shrink-0 bg-neutral-950/60 backdrop-blur-md">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden text-neutral-400 hover:text-neutral-200 cursor-pointer p-1"
          >
            <Menu className="w-6 h-6" />
          </button>
          
          <div className="flex items-center gap-4 ml-auto">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-neutral-900 text-neutral-400 hover:text-neutral-200 cursor-pointer border border-white/5 bg-neutral-950/40"
              title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-400" />}
            </button>
            <div className="flex items-center gap-2 text-xs text-neutral-400 font-semibold bg-neutral-900 px-3 py-1.5 rounded-full border border-white/5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span>Agent Active — Timezone: {user?.timezone}</span>
            </div>
          </div>
        </header>

        {/* View container */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 pb-safe">
          <div className="max-w-6xl mx-auto">
            {renderActiveView()}
          </div>
        </main>
      </div>

      {/* Floating AI Chat button */}
      <button
        id="open-copilot-btn"
        onClick={() => setChatOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white flex items-center justify-center cursor-pointer shadow-lg shadow-indigo-600/30 transition-transform hover:scale-105 z-40 border border-white/10 group animate-bounce"
        style={{ animationDuration: '3s' }}
        title="Open AI Copilot Chat"
      >
        <Sparkles className="w-6 h-6 group-hover:rotate-12 transition-transform" />
      </button>

      {/* AI Copilot Side Drawer */}
      <AgentChatPanel 
        isOpen={chatOpen} 
        onClose={() => setChatOpen(false)} 
        onSuggestionApplied={() => {
          // Dispatch global reload event
          window.dispatchEvent(new Event('agent-action-applied'));
        }}
      />
    </div>
  );
};
