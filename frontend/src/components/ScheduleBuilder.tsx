import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  CalendarDays, Plus, Trash2, Star, Settings2, X
} from 'lucide-react';

interface Block {
  startTime: string;
  endTime: string;
  label: string;
  type: 'work' | 'meeting' | 'break' | 'personal' | 'focus';
  color: string;
}

interface ScheduleTemplate {
  _id: string;
  name: string;
  isDefault: boolean;
  blocks: Block[];
}

const TYPE_COLORS: Record<string, string> = {
  work: '#3b82f6',     // Blue
  meeting: '#f59e0b',  // Amber
  break: '#10b981',    // Emerald
  personal: '#ec4899', // Pink
  focus: '#8b5cf6'     // Violet
};

export const ScheduleBuilder: React.FC = () => {
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  // New block form states
  const [blockLabel, setBlockLabel] = useState('');
  const [blockType, setBlockType] = useState<'work' | 'meeting' | 'break' | 'personal' | 'focus'>('work');
  const [blockStart, setBlockStart] = useState('09:00');
  const [blockEnd, setBlockEnd] = useState('11:00');
  const [blockColor, setBlockColor] = useState('#3b82f6');

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/schedule/templates');
      setTemplates(response.data);
      if (response.data.length > 0) {
        // Automatically load default or first template
        const def = response.data.find((t: any) => t.isDefault) || response.data[0];
        loadTemplate(def);
      }
    } catch (err) {
      console.error('Failed to fetch schedule templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplate = (template: ScheduleTemplate) => {
    setSelectedTemplateId(template._id);
    setName(template.name);
    setBlocks(template.blocks);
  };

  const handleCreateNewTemplate = () => {
    setSelectedTemplateId(null);
    setName('New Daily Template');
    setBlocks([]);
  };

  const handleAddBlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockLabel || !blockStart || !blockEnd) return;

    // Validate times (start < end)
    if (blockStart >= blockEnd) {
      alert('Start time must be before end time');
      return;
    }

    const newBlock: Block = {
      startTime: blockStart,
      endTime: blockEnd,
      label: blockLabel,
      type: blockType,
      color: blockColor
    };

    setBlocks(prev => [...prev, newBlock].sort((a, b) => a.startTime.localeCompare(b.startTime)));
    
    // Reset block form
    setBlockLabel('');
    setBlockType('work');
    setBlockStart('09:00');
    setBlockEnd('11:00');
    setBlockColor('#3b82f6');
  };

  const handleRemoveBlock = (index: number) => {
    setBlocks(prev => prev.filter((_, idx) => idx !== index));
  };

  const handleSaveTemplate = async () => {
    if (!name.trim()) return;

    const payload = {
      name,
      blocks,
      isDefault: false // can toggle from list later
    };

    try {
      if (selectedTemplateId) {
        await api.put(`/schedule/templates/${selectedTemplateId}`, payload);
      } else {
        const response = await api.post('/schedule/templates', payload);
        setSelectedTemplateId(response.data._id);
      }
      fetchTemplates();
      alert('Template saved successfully!');
    } catch (err) {
      console.error('Failed to save template:', err);
    }
  };

  const handleSetDefault = async (templateId: string) => {
    try {
      const template = templates.find(t => t._id === templateId);
      if (!template) return;
      
      await api.put(`/schedule/templates/${templateId}`, { ...template, isDefault: true });
      fetchTemplates();
    } catch (err) {
      console.error('Failed to set default template:', err);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      await api.delete(`/schedule/templates/${templateId}`);
      if (selectedTemplateId === templateId) {
        handleCreateNewTemplate();
      }
      fetchTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto select-none">
      {/* Templates Selector Drawer */}
      <div className="lg:col-span-1 glass-panel rounded-2xl p-6 shadow-xl space-y-4 h-fit">
        <div className="flex items-center justify-between border-b border-white/5 pb-3">
          <div className="flex items-center gap-2">
            <Settings2 className="w-5 h-5 text-indigo-400" />
            <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Saved Schedules</h2>
          </div>
          <button
            onClick={handleCreateNewTemplate}
            className="p-1 text-xs bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded cursor-pointer transition-colors"
          >
            New Template
          </button>
        </div>

        {loading ? (
          <div className="text-neutral-500 text-xs py-4 text-center">Loading templates...</div>
        ) : templates.length === 0 ? (
          <div className="text-neutral-500 text-xs py-4 text-center border border-dashed border-white/5 rounded-xl">
            No daily templates saved.
          </div>
        ) : (
          <div className="space-y-2">
            {templates.map((temp) => (
              <div
                key={temp._id}
                onClick={() => loadTemplate(temp)}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between ${
                  selectedTemplateId === temp._id
                    ? 'bg-indigo-950/20 border-indigo-500/30'
                    : 'glass-panel border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs font-bold text-neutral-200 truncate">{temp.name}</h4>
                    {temp.isDefault && (
                      <span className="text-[8px] bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 rounded-full font-bold">
                        Default
                      </span>
                    )}
                  </div>
                  <p className="text-[9px] text-neutral-500 font-semibold mt-0.5">{temp.blocks.length} time blocks configured</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  {!temp.isDefault && (
                    <button
                      onClick={() => handleSetDefault(temp._id)}
                      className="p-1 rounded text-neutral-400 hover:text-amber-400 cursor-pointer"
                      title="Set as active default template"
                    >
                      <Star className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => handleDeleteTemplate(temp._id)}
                    className="p-1 rounded text-neutral-500 hover:text-red-400 cursor-pointer"
                    title="Delete template"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Editor Main Canvas */}
      <div className="lg:col-span-2 space-y-6">
        <div className="glass-panel rounded-2xl p-6 shadow-xl">
          {/* Template Details Heading */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/5 pb-4 gap-4">
            <div className="flex-1">
              <label className="block text-[8px] font-bold uppercase tracking-wider text-neutral-500 mb-1">Active Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="text-base font-bold bg-transparent text-neutral-100 border-none outline-none focus:ring-1 focus:ring-indigo-500/20 rounded px-1 w-full"
                placeholder="Template Name (e.g. Office Days)"
              />
            </div>
            <button
              onClick={handleSaveTemplate}
              className="py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl cursor-pointer shadow-lg shadow-indigo-600/10 shrink-0 self-end sm:self-center transition-colors"
            >
              Save Template
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
            {/* Timeline block configurer */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Configure Blocks</h3>

              <form onSubmit={handleAddBlock} className="space-y-3.5 glass-panel p-4 rounded-xl border border-white/5 bg-neutral-900/10">
                <div>
                  <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Block Label</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Daily Standup, Lunch Break"
                    value={blockLabel}
                    onChange={(e) => setBlockLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Block Type</label>
                    <select
                      value={blockType}
                      onChange={(e) => {
                        const t = e.target.value as any;
                        setBlockType(t);
                        setBlockColor(TYPE_COLORS[t]);
                      }}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-300"
                    >
                      <option value="work">Work 💻</option>
                      <option value="meeting">Meeting 🤝</option>
                      <option value="break">Break ☕</option>
                      <option value="personal">Personal 🧘</option>
                      <option value="focus">Focus Sprint 🧠</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Tag Color</label>
                    <input
                      type="color"
                      value={blockColor}
                      onChange={(e) => setBlockColor(e.target.value)}
                      className="w-full h-8 px-1.5 py-0.5 rounded-lg glass-input cursor-pointer"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">Start Time</label>
                    <input
                      type="time"
                      required
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold uppercase tracking-wider text-neutral-400 mb-1">End Time</label>
                    <input
                      type="time"
                      required
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-100 font-mono"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-semibold text-xs rounded-lg cursor-pointer border border-indigo-500/20 transition-all flex items-center justify-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Block
                </button>
              </form>
            </div>

            {/* Timeline Visual Preview */}
            <div className="space-y-4">
              <h3 className="text-xs font-bold text-neutral-200 uppercase tracking-wider">Visual Schedule preview</h3>

              {blocks.length === 0 ? (
                <div className="h-64 flex flex-col items-center justify-center text-neutral-600 text-xs border border-dashed border-white/5 rounded-xl">
                  <CalendarDays className="w-8 h-8 mb-2 text-neutral-700" />
                  <p>Timeline is empty.</p>
                  <p className="text-[10px] text-neutral-700">Add work blocks or break periods.</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {blocks.map((block, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-xl border border-white/5 bg-neutral-900/40 relative overflow-hidden group/item"
                    >
                      <div
                        className="absolute left-0 top-0 bottom-0 w-1.5"
                        style={{ backgroundColor: block.color }}
                      ></div>
                      <div className="pl-2">
                        <h4 className="text-xs font-bold text-neutral-200">{block.label}</h4>
                        <div className="flex items-center gap-2 mt-0.5 text-[9px] text-neutral-500 font-semibold font-mono">
                          <span>{block.startTime} - {block.endTime}</span>
                          <span className="capitalize px-1 bg-neutral-950 rounded text-neutral-400">{block.type}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveBlock(idx)}
                        className="text-neutral-500 hover:text-red-400 p-1 rounded-md cursor-pointer hover:bg-neutral-800 shrink-0 opacity-0 group-hover/item:opacity-100 transition-opacity"
                        title="Remove block"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
