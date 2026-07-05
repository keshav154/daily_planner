import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Volume2, Sparkles } from 'lucide-react';

interface Task {
  _id: string;
  title: string;
  status: string;
}

interface PomodoroTimerProps {
  tasks: Task[];
  onTimerComplete: (task: Task, durationMinutes: number) => void;
}

type SoundType = 'off' | 'white' | 'rain' | 'ocean';

export const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ tasks, onTimerComplete }) => {
  const [activeTaskId, setActiveTaskId] = useState('');
  const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes default
  const [isRunning, setIsRunning] = useState(false);
  const [sound, setSound] = useState<SoundType>('off');
  const [preset, setPreset] = useState(25); // 25 or 50

  const timerIntervalRef = useRef<any>(null);
  
  // Web Audio Context references for ambient sound synthesis
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);

  // Filter tasks to show only pending ones
  const activeTasks = tasks.filter(t => t.status !== 'done');

  // Sync preset changes
  const applyPreset = (mins: number) => {
    setPreset(mins);
    setTimeLeft(mins * 60);
    setIsRunning(false);
    stopAudio();
    setSound('off');
  };

  useEffect(() => {
    if (isRunning) {
      timerIntervalRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            handleComplete();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isRunning]);

  // Handle Audio State triggers on Sound state changes
  useEffect(() => {
    if (isRunning && sound !== 'off') {
      startAudio();
    } else {
      stopAudio();
    }
    return () => stopAudio();
  }, [sound, isRunning]);

  const handleComplete = () => {
    setIsRunning(false);
    stopAudio();
    setSound('off');
    
    // Find active task
    const task = tasks.find(t => t._id === activeTaskId);
    if (task) {
      onTimerComplete(task, preset);
    } else {
      // General focus log callback
      onTimerComplete({ _id: '', title: 'General Focus Session', status: 'todo' }, preset);
    }
    
    // Reset timer
    setTimeLeft(preset * 60);
  };

  const handleTogglePlay = () => {
    setIsRunning(!isRunning);
  };

  const handleReset = () => {
    setIsRunning(false);
    setTimeLeft(preset * 60);
    stopAudio();
    setSound('off');
  };

  // --- HTML5 Web Audio Noise Synthesis ---
  const startAudio = () => {
    stopAudio(); // Ensure clean start

    try {
      // 1. Initialize Audio Context
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      // 2. Create Gain node (volume)
      const gainNode = audioCtx.createGain();
      gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime); // keep volume low/ambient
      gainNodeRef.current = gainNode;

      // 3. Create Audio buffer for noise
      const bufferSize = 2 * audioCtx.sampleRate;
      const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const output = noiseBuffer.getChannelData(0);

      // 4. Fill buffer depending on noise type
      if (sound === 'white') {
        // Pure random values (white noise)
        for (let i = 0; i < bufferSize; i++) {
          output[i] = Math.random() * 2 - 1;
        }
      } else if (sound === 'rain' || sound === 'ocean') {
        // Brownian noise (Rain rumble/ocean wash)
        // Accumulated values create low-pass filtering effect natively
        let lastOut = 0.0;
        for (let i = 0; i < bufferSize; i++) {
          const white = Math.random() * 2 - 1;
          output[i] = (lastOut + (0.02 * white)) / 1.02;
          lastOut = output[i];
          output[i] *= 3.5; // Compensate for volume loss
        }
      }

      // 5. Create buffer source
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;
      noiseSourceRef.current = noiseSource;

      // 6. Hook up nodes
      if (sound === 'ocean') {
        // Ocean Wave simulation: modulate gain node volume with a Slow LFO (0.08 Hz)
        const lfo = audioCtx.createOscillator();
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(0.08, audioCtx.currentTime); // ~12 second waves cycle

        const lfoGain = audioCtx.createGain();
        lfoGain.gain.setValueAtTime(0.06, audioCtx.currentTime);

        // Connect LFO modulation to gain node volume parameter
        lfo.connect(lfoGain);
        lfoGain.connect(gainNode.gain);
        lfo.start();
        lfoRef.current = lfo;
      }

      // Connect noise -> gain -> destination
      noiseSource.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      noiseSource.start();
    } catch (e) {
      console.error('Failed to start synthesis engine:', e);
    }
  };

  const stopAudio = () => {
    try {
      if (noiseSourceRef.current) {
        noiseSourceRef.current.stop();
        noiseSourceRef.current.disconnect();
      }
      if (lfoRef.current) {
        lfoRef.current.stop();
        lfoRef.current.disconnect();
      }
      if (gainNodeRef.current) {
        gainNodeRef.current.disconnect();
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        audioCtxRef.current.close();
      }
    } catch (e) {
      // Ignore audio termination conflicts
    }
    noiseSourceRef.current = null;
    lfoRef.current = null;
    gainNodeRef.current = null;
    audioCtxRef.current = null;
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="glass-panel rounded-xl p-5 shadow-xl relative overflow-hidden flex flex-col items-center text-center space-y-4">
      {/* Small sparkles header */}
      <div className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold uppercase tracking-wider select-none">
        <Sparkles className="w-3.5 h-3.5 animate-pulse" />
        <span>Focus Pomodoro</span>
      </div>

      {/* Preset select */}
      <div className="flex gap-2 bg-neutral-950/60 p-1 rounded-lg border border-white/5">
        <button
          onClick={() => applyPreset(25)}
          className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
            preset === 25 ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          25 Mins
        </button>
        <button
          onClick={() => applyPreset(50)}
          className={`px-3 py-1 text-[10px] font-bold rounded cursor-pointer transition-all ${
            preset === 50 ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'
          }`}
        >
          50 Mins
        </button>
      </div>

      {/* Clock display */}
      <div className="text-4xl font-black text-neutral-100 font-mono tracking-tight select-none">
        {formatTime(timeLeft)}
      </div>

      {/* Task selector */}
      <div className="w-full">
        <select
          className="w-full px-3 py-1.5 rounded-lg text-xs text-neutral-300 glass-input cursor-pointer"
          value={activeTaskId}
          onChange={(e) => setActiveTaskId(e.target.value)}
        >
          <option value="">-- Focus Goal: General --</option>
          {activeTasks.map(t => (
            <option key={t._id} value={t._id}>
              Focus: {t.title}
            </option>
          ))}
        </select>
      </div>

      {/* Audio Ambient controls */}
      <div className="flex items-center justify-center gap-3 w-full border-t border-b border-white/5 py-2.5">
        <span className="text-[10px] text-neutral-400 font-semibold flex items-center gap-1">
          <Volume2 className="w-3.5 h-3.5 text-neutral-500" /> Sound:
        </span>
        <div className="flex gap-1.5">
          {(['off', 'white', 'rain', 'ocean'] as SoundType[]).map((s) => (
            <button
              key={s}
              onClick={() => setSound(s)}
              className={`px-2 py-0.5 text-[9px] font-bold rounded capitalize cursor-pointer transition-colors ${
                sound === s 
                  ? 'bg-neutral-800 text-indigo-400 border border-indigo-500/20' 
                  : 'text-neutral-500 hover:text-neutral-300 border border-transparent'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Timer Controls */}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={handleTogglePlay}
          className={`w-10 h-10 rounded-full flex items-center justify-center text-white cursor-pointer shadow-lg transition-transform hover:scale-105 ${
            isRunning 
              ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/10' 
              : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/10'
          }`}
        >
          {isRunning ? <Pause className="w-4.5 h-4.5" /> : <Play className="w-4.5 h-4.5 pl-0.5" />}
        </button>
        <button
          onClick={handleReset}
          className="w-10 h-10 rounded-full bg-neutral-800 hover:bg-neutral-700 text-neutral-400 hover:text-neutral-200 flex items-center justify-center cursor-pointer transition-colors"
          title="Reset timer"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
