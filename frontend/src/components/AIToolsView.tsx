import React, { useState } from 'react';
import { Brain, Layers, FileText } from 'lucide-react';
import { TaskDecomposer } from './TaskDecomposer';
import { MeetingSummariser } from './MeetingSummariser';

type Tab = 'decomposer' | 'meeting';

export const AIToolsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('decomposer');

  const tabs: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'decomposer', label: 'Task Decomposer', icon: Layers },
    { id: 'meeting', label: 'Meeting Summariser', icon: FileText },
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-600/20 flex items-center justify-center border border-indigo-500/20">
          <Brain className="w-5 h-5 text-indigo-400" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-neutral-100 tracking-tight">AI Tools</h1>
          <p className="text-xs text-neutral-500">Supercharge your productivity with AI-powered workflows</p>
        </div>
        <span className="ml-auto text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 px-3 py-1 rounded-full">
          ✨ AI Powered
        </span>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center gap-1 p-1 glass-panel rounded-xl w-fit">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`ai-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-200 ${
                isActive
                  ? 'bg-indigo-600/20 text-indigo-300 border border-indigo-500/20 shadow-sm'
                  : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : ''}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active indicator underline */}
      <div className="h-px bg-white/5 -mt-4" />

      {/* Tab Content */}
      {activeTab === 'decomposer' && <TaskDecomposer />}
      {activeTab === 'meeting' && <MeetingSummariser />}
    </div>
  );
};
