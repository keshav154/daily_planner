import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Copy, Trash2, Check, Loader2, Sparkles, FolderHeart
} from 'lucide-react';

interface SubtaskItem {
  title: string;
}

interface TemplateTask {
  title: string;
  estimatedTime: number;
  priority: 'high' | 'medium' | 'low';
  category: string;
  subtasks: SubtaskItem[];
}

interface TaskTemplate {
  _id: string;
  name: string;
  tasks: TemplateTask[];
}

export const TaskTemplatesView: React.FC = () => {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [applyingId, setApplyingId] = useState<string | null>(null);

  // New Template Form States
  const [templateName, setTemplateName] = useState('');
  const [tempTasks, setTempTasks] = useState<TemplateTask[]>([]);

  // Task draft inside template
  const [taskTitle, setTaskTitle] = useState('');
  const [taskEst, setTaskEst] = useState(30);
  const [taskPriority, setTaskPriority] = useState<'high' | 'medium' | 'low'>('medium');
  const [taskCategory, setTaskCategory] = useState('Work');
  const [draftSubtasks, setDraftSubtasks] = useState<string>(''); // comma-separated

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const response = await api.get('/templates');
      setTemplates(response.data);
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddTaskToDraft = (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle) return;

    const subtasks = draftSubtasks
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(title => ({ title }));

    const newTask: TemplateTask = {
      title: taskTitle,
      estimatedTime: Number(taskEst),
      priority: taskPriority,
      category: taskCategory,
      subtasks
    };

    setTempTasks(prev => [...prev, newTask]);
    
    // Reset task form fields
    setTaskTitle('');
    setTaskEst(30);
    setTaskPriority('medium');
    setTaskCategory('Work');
    setDraftSubtasks('');
  };

  const handleRemoveTaskFromDraft = (idx: number) => {
    setTempTasks(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) {
      alert('Please enter a template name first.');
      return;
    }

    let finalTasks = [...tempTasks];

    // If they haven't explicitly clicked 'Add Task to Template', but have filled out a task title, auto-add it.
    if (finalTasks.length === 0) {
      if (taskTitle.trim()) {
        const subtasks = draftSubtasks
          .split(',')
          .map(s => s.trim())
          .filter(s => s.length > 0)
          .map(title => ({ title }));

        finalTasks.push({
          title: taskTitle.trim(),
          estimatedTime: Number(taskEst),
          priority: taskPriority,
          category: taskCategory,
          subtasks
        });
      } else {
        alert('Please add at least one task to the template first.');
        return;
      }
    }

    try {
      await api.post('/templates', {
        name: templateName,
        tasks: finalTasks
      });
      fetchTemplates();
      setTemplateName('');
      setTempTasks([]);
      setTaskTitle('');
      setDraftSubtasks('');
      alert('Task template saved successfully!');
    } catch (err: any) {
      console.error('Failed to save template:', err);
      alert('Failed to save template: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleApplyTemplate = async (templateId: string) => {
    setApplyingId(templateId);
    try {
      await api.post(`/templates/${templateId}/apply`);
      alert('Template applied! Tasks successfully spawned for today.');
    } catch (err) {
      console.error('Failed to apply template:', err);
    } finally {
      setApplyingId(null);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      await api.delete(`/templates/${templateId}`);
      fetchTemplates();
    } catch (err) {
      console.error('Failed to delete template:', err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 max-w-7xl mx-auto select-none">
      {/* Form column */}
      <div className="lg:col-span-1 glass-panel rounded-2xl p-6 shadow-xl space-y-4 h-fit">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Copy className="w-5 h-5 text-indigo-400" />
          <h2 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Create Task Template</h2>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Template Name</label>
            <input 
              type="text"
              placeholder="e.g. Morning Standup prep, WFH Start"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
            />
          </div>

          {/* Form to add a task to the template definition */}
          <form onSubmit={handleAddTaskToDraft} className="glass-panel p-4 rounded-xl border border-white/5 bg-neutral-900/10 space-y-3.5">
            <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider">Define Task Draft</h4>
            
            <div>
              <label className="block text-[9px] text-neutral-500 font-bold uppercase mb-1">Task Title *</label>
              <input 
                type="text"
                required
                placeholder="e.g. Check server health logs"
                value={taskTitle}
                onChange={(e) => setTaskTitle(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs glass-input"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[9px] text-neutral-500 font-bold uppercase mb-1">Duration (m)</label>
                <input 
                  type="number"
                  value={taskEst}
                  onChange={(e) => setTaskEst(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-xs glass-input"
                />
              </div>
              <div>
                <label className="block text-[9px] text-neutral-500 font-bold uppercase mb-1">Category</label>
                <input 
                  type="text"
                  value={taskCategory}
                  onChange={(e) => setTaskCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-xs glass-input"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-[9px] text-neutral-500 font-bold uppercase mb-1">Priority</label>
                <select
                  value={taskPriority}
                  onChange={(e) => setTaskPriority(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg text-xs glass-input text-neutral-300"
                >
                  <option value="high">High 🔴</option>
                  <option value="medium">Medium 🟡</option>
                  <option value="low">Low 🟢</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[9px] text-neutral-500 font-bold uppercase mb-1">Subtasks (comma-separated)</label>
              <input 
                type="text"
                placeholder="e.g. Open console, verify endpoints, print report"
                value={draftSubtasks}
                onChange={(e) => setDraftSubtasks(e.target.value)}
                className="w-full px-3 py-2 rounded-lg text-xs glass-input"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 font-bold text-[10px] rounded-lg cursor-pointer border border-indigo-500/20 transition-colors"
            >
              Add Task to Template
            </button>
          </form>

          {/* List of Tasks in current template draft */}
          {tempTasks.length > 0 && (
            <div className="space-y-2 border-t border-white/5 pt-3">
              <h4 className="text-[10px] font-bold text-neutral-400 uppercase tracking-wider mb-1.5">Draft Task List ({tempTasks.length})</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                {tempTasks.map((t, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2.5 rounded-lg border border-white/5 bg-neutral-900/30">
                    <div className="min-w-0 pr-2">
                      <p className="text-xs font-bold text-neutral-300 truncate">{t.title}</p>
                      <p className="text-[9px] text-neutral-500 font-bold font-mono uppercase mt-0.5">{t.estimatedTime}m | {t.priority}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveTaskFromDraft(idx)}
                      className="text-neutral-500 hover:text-red-400 p-1 rounded hover:bg-neutral-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={handleSaveTemplate}
                className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl cursor-pointer transition-all duration-250 flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
              >
                <Check className="w-4 h-4" />
                <span>Save All as Template</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main List */}
      <div className="lg:col-span-2 space-y-4">
        <div className="glass-panel rounded-2xl p-6 shadow-xl min-h-[500px]">
          <div className="border-b border-white/5 pb-4 mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Saved Templates</h3>
            <span className="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
              Instant Task Instantiation
            </span>
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-neutral-500 text-sm">
              Loading templates...
            </div>
          ) : templates.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-neutral-500 text-sm space-y-2 border border-dashed border-white/5 rounded-xl p-6">
              <FolderHeart className="w-8 h-8 text-neutral-600" />
              <p>No task templates saved.</p>
              <p className="text-[10px] text-neutral-600">Create templates for tasks you repeat often (e.g. release checkpoints, weekly reports).</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((temp) => (
                <div key={temp._id} className="glass-panel rounded-xl p-4 flex flex-col justify-between border border-white/5 hover:border-white/10 transition-all shadow-sm">
                  <div>
                    <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2 gap-2">
                      <h4 className="font-bold text-neutral-100 text-sm truncate">{temp.name}</h4>
                      <span className="text-[9px] font-bold bg-indigo-500/10 text-indigo-400 px-2 py-0.5 rounded font-mono shrink-0">
                        {temp.tasks.length} Tasks
                      </span>
                    </div>

                    <div className="space-y-1.5 max-h-32 overflow-y-auto mb-4 select-text">
                      {temp.tasks.map((task, tIdx) => (
                        <div key={tIdx} className="text-[10px] text-neutral-400 font-semibold flex items-center gap-1.5 leading-snug">
                          <span className="w-1 h-1 rounded-full bg-indigo-500 shrink-0"></span>
                          <span className="truncate flex-1">{task.title}</span>
                          <span className="text-neutral-500 font-mono text-[8px] shrink-0 font-bold uppercase">({task.estimatedTime}m)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-white/5">
                    <button
                      onClick={() => handleApplyTemplate(temp._id)}
                      disabled={applyingId === temp._id}
                      className="py-1.5 px-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] rounded-lg cursor-pointer flex items-center gap-1 transition-colors disabled:opacity-50"
                    >
                      {applyingId === temp._id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Apply to Today</span>
                    </button>

                    <button
                      onClick={() => handleDeleteTemplate(temp._id)}
                      className="text-neutral-500 hover:text-red-400 p-1.5 rounded-lg cursor-pointer hover:bg-neutral-800 transition-colors"
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
      </div>
    </div>
  );
};
