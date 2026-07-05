import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { 
  Repeat, Plus, Trash2, Edit3, Save, Calendar, Link2, 
  MapPin, Check, ToggleLeft, ToggleRight 
} from 'lucide-react';

interface RecurringEvent {
  _id: string;
  title: string;
  description: string;
  type: 'meeting' | 'standup' | 'task' | 'break' | 'block';
  recurrence: {
    pattern: 'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly';
    daysOfWeek: number[];
    interval: number;
    endDate?: string;
  };
  startTime: string;
  endTime: string;
  category: string;
  color: string;
  location?: string;
  meetingLink?: string;
  isActive: boolean;
}

const PRESET_COLORS = [
  '#6366f1', // Indigo
  '#ec4899', // Pink
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#3b82f6', // Blue
  '#8b5cf6'  // Violet
];

export const RecurringEventsManager: React.FC = () => {
  const [events, setEvents] = useState<RecurringEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'meeting' | 'standup' | 'task' | 'break' | 'block'>('meeting');
  const [pattern, setPattern] = useState<'daily' | 'weekdays' | 'weekly' | 'biweekly' | 'monthly'>('weekly');
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1]); // Default Monday
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('09:30');
  const [category, setCategory] = useState('Work');
  const [color, setColor] = useState('#6366f1');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [endDate, setEndDate] = useState('');

  const daysLabel = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  useEffect(() => {
    fetchEvents();
  }, []);

  const fetchEvents = async () => {
    try {
      const response = await api.get('/recurring');
      setEvents(response.data);
    } catch (err) {
      console.error('Failed to fetch recurring events:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDay = (day: number) => {
    setDaysOfWeek(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const resetForm = () => {
    setTitle('');
    setDescription('');
    setType('meeting');
    setPattern('weekly');
    setDaysOfWeek([1]);
    setStartTime('09:00');
    setEndTime('09:30');
    setCategory('Work');
    setColor('#6366f1');
    setLocation('');
    setMeetingLink('');
    setEndDate('');
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !startTime || !endTime) return;

    const payload = {
      title,
      description,
      type,
      recurrence: {
        pattern,
        daysOfWeek: (pattern === 'weekly' || pattern === 'biweekly') ? daysOfWeek : [],
        interval: pattern === 'biweekly' ? 2 : 1,
        endDate: endDate ? new Date(endDate) : undefined
      },
      startTime,
      endTime,
      category,
      color,
      location: location || undefined,
      meetingLink: meetingLink || undefined
    };

    try {
      if (editingId) {
        await api.put(`/recurring/${editingId}`, payload);
      } else {
        await api.post('/recurring', payload);
      }
      fetchEvents();
      resetForm();
    } catch (err) {
      console.error('Failed to save recurring event:', err);
    }
  };

  const handleEdit = (event: RecurringEvent) => {
    setEditingId(event._id);
    setTitle(event.title);
    setDescription(event.description || '');
    setType(event.type);
    setPattern(event.recurrence.pattern);
    setDaysOfWeek(event.recurrence.daysOfWeek || []);
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setCategory(event.category);
    setColor(event.color);
    setLocation(event.location || '');
    setMeetingLink(event.meetingLink || '');
    setEndDate(event.recurrence.endDate ? event.recurrence.endDate.split('T')[0] : '');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this recurring event?')) return;
    try {
      await api.delete(`/recurring/${id}`);
      fetchEvents();
    } catch (err) {
      console.error('Failed to delete recurring event:', err);
    }
  };

  const handleToggleActive = async (event: RecurringEvent) => {
    try {
      await api.put(`/recurring/${event._id}`, { isActive: !event.isActive });
      fetchEvents();
    } catch (err) {
      console.error('Failed to toggle active state:', err);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 select-none max-w-7xl mx-auto">
      {/* Editor Column */}
      <div className="lg:col-span-1 glass-panel rounded-2xl p-6 shadow-xl space-y-5 h-fit">
        <div className="flex items-center gap-2 border-b border-white/5 pb-3">
          <Repeat className="w-5 h-5 text-indigo-400" />
          <h2 className="text-base font-bold text-neutral-100 uppercase tracking-wider">
            {editingId ? 'Edit Event Rule' : 'Create Recurring Event'}
          </h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Event Title *</label>
            <input 
              type="text" 
              required
              placeholder="e.g. Daily Sync, Weekly Catchup"
              value={title} 
              onChange={(e) => setTitle(e.target.value)} 
              className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
            />
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Description</label>
            <textarea 
              placeholder="Add optional notes or agendas"
              value={description} 
              onChange={(e) => setDescription(e.target.value)} 
              className="w-full px-3.5 py-2 rounded-xl text-sm glass-input text-neutral-100 h-16 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Event Type</label>
              <select 
                value={type} 
                onChange={(e) => setType(e.target.value as any)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-300"
              >
                <option value="meeting">Meeting 🤝</option>
                <option value="standup">Standup ⏰</option>
                <option value="task">Focus Task 🎯</option>
                <option value="break">Break ☕</option>
                <option value="block">Time Block 🔒</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Category</label>
              <input 
                type="text" 
                value={category} 
                onChange={(e) => setCategory(e.target.value)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Start Time *</label>
              <input 
                type="time" 
                required
                value={startTime} 
                onChange={(e) => setStartTime(e.target.value)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100 font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">End Time *</label>
              <input 
                type="time" 
                required
                value={endTime} 
                onChange={(e) => setEndTime(e.target.value)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Recurrence Pattern</label>
            <select 
              value={pattern} 
              onChange={(e) => setPattern(e.target.value as any)} 
              className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-300"
            >
              <option value="daily">Every Day</option>
              <option value="weekdays">Weekdays (Mon-Fri)</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly (Every 2 weeks)</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>

          {/* Days of week selector for weekly/biweekly patterns */}
          {(pattern === 'weekly' || pattern === 'biweekly') && (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Days of the Week</label>
              <div className="flex justify-between gap-1">
                {daysLabel.map((label, idx) => {
                  const active = daysOfWeek.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleToggleDay(idx)}
                      className={`flex-1 py-1.5 rounded-lg text-[10px] font-bold cursor-pointer transition-all border ${
                        active 
                          ? 'bg-indigo-600 border-indigo-500 text-white shadow-lg shadow-indigo-600/10' 
                          : 'glass-input text-neutral-400 hover:text-neutral-200'
                      }`}
                    >
                      {label[0]}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Location</label>
              <input 
                type="text" 
                placeholder="e.g. Room B"
                value={location} 
                onChange={(e) => setLocation(e.target.value)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Recurrence End Date</label>
              <input 
                type="date" 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
                className="w-full px-3.5 py-2.5 rounded-xl text-sm glass-input text-neutral-300 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Meeting URL Link</label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500">
                <Link2 className="w-4 h-4" />
              </span>
              <input 
                type="url" 
                placeholder="https://zoom.us/j/..."
                value={meetingLink} 
                onChange={(e) => setMeetingLink(e.target.value)} 
                className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm glass-input text-neutral-100"
              />
            </div>
          </div>

          {/* Color Presets */}
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Calendar Tag Color</label>
            <div className="flex gap-2.5">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className="w-7 h-7 rounded-full cursor-pointer relative shrink-0 transition-transform hover:scale-105 border border-white/10"
                  style={{ backgroundColor: c }}
                >
                  {color === c && (
                    <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-black">
                      <Check className="w-4 h-4" />
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs rounded-xl cursor-pointer transition-all duration-250 flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20"
            >
              {editingId ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
              <span>{editingId ? 'Save Changes' : 'Create Event'}</span>
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="py-3 px-4 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 font-medium text-xs rounded-xl cursor-pointer transition-colors"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Rules List Column */}
      <div className="lg:col-span-2 space-y-4">
        <div className="glass-panel rounded-2xl p-6 shadow-xl min-h-[500px]">
          <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
            <h3 className="text-sm font-bold text-neutral-100 uppercase tracking-wider">Active Calendar Rules</h3>
            <span className="text-[10px] font-bold bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-full border border-indigo-500/20">
              {events.length} Rules Configured
            </span>
          </div>

          {loading ? (
            <div className="h-48 flex items-center justify-center text-neutral-500 text-sm">
              Loading event rules...
            </div>
          ) : events.length === 0 ? (
            <div className="h-48 flex flex-col items-center justify-center text-neutral-500 text-sm space-y-2 border border-dashed border-white/5 rounded-xl p-6">
              <Calendar className="w-8 h-8 text-neutral-600" />
              <p>No recurring events configured.</p>
              <p className="text-[10px] text-neutral-600">Add standups, weekly review Syncs, or blocked working blocks.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {events.map((event) => {
                const daysDesc = event.recurrence.pattern === 'weekly' || event.recurrence.pattern === 'biweekly'
                  ? ` (${event.recurrence.daysOfWeek.map(d => daysLabel[d]).join(', ')})`
                  : '';
                const patternLabel = event.recurrence.pattern.charAt(0).toUpperCase() + event.recurrence.pattern.slice(1) + daysDesc;

                return (
                  <div 
                    key={event._id} 
                    className={`glass-panel rounded-xl p-4 flex flex-col justify-between border-l-4 hover:border-r hover:border-white/5 transition-all shadow-md relative group ${
                      !event.isActive ? 'opacity-60' : ''
                    }`}
                    style={{ borderLeftColor: event.color }}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <h4 className="font-bold text-neutral-100 text-sm tracking-tight truncate flex-1">{event.title}</h4>
                        <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase ${
                          event.type === 'meeting' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/10' :
                          event.type === 'standup' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/10' :
                          event.type === 'task' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' :
                          'bg-neutral-800 text-neutral-400'
                        }`}>
                          {event.type}
                        </span>
                      </div>
                      
                      {event.description && (
                        <p className="text-[11px] text-neutral-400 line-clamp-2 mb-2 select-text">{event.description}</p>
                      )}

                      <div className="space-y-1.5 text-[10px] text-neutral-500 font-semibold mb-4">
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-500"></span>
                          <span>Time: <span className="text-neutral-300 font-bold">{event.startTime} - {event.endTime}</span></span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-violet-500"></span>
                          <span className="truncate">Recurrence: <span className="text-neutral-300">{patternLabel}</span></span>
                        </div>
                        {event.location && (
                          <div className="flex items-center gap-1.5">
                            <MapPin className="w-3 h-3 text-neutral-600 shrink-0" />
                            <span className="truncate">{event.location}</span>
                          </div>
                        )}
                        {event.meetingLink && (
                          <div className="flex items-center gap-1.5">
                            <Link2 className="w-3 h-3 text-indigo-400 shrink-0" />
                            <a 
                              href={event.meetingLink} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-indigo-400 hover:underline truncate"
                            >
                              Join Meeting
                            </a>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2.5 border-t border-white/5">
                      <button
                        onClick={() => handleToggleActive(event)}
                        className="text-neutral-400 hover:text-neutral-200 cursor-pointer"
                        title={event.isActive ? 'Pause rule' : 'Activate rule'}
                      >
                        {event.isActive ? <ToggleRight className="w-7 h-7 text-indigo-500" /> : <ToggleLeft className="w-7 h-7" />}
                      </button>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => handleEdit(event)}
                          className="p-1.5 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 cursor-pointer border border-white/5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(event._id)}
                          className="p-1.5 rounded-lg bg-red-950/20 hover:bg-red-900/30 text-red-400 cursor-pointer border border-red-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
