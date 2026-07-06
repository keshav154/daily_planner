import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, RotateCcw, Volume2, Sparkles, Maximize2, Minimize2 } from 'lucide-react';

interface Task {
  _id: string;
  title: string;
  status: string;
}

interface PomodoroTimerProps {
  tasks: Task[];
  onTimerComplete: (task: Task, durationMinutes: number) => void;
}

type SoundType = 'off' | 'white' | 'rain' | 'ocean' | 'campfire' | 'forest' | 'binaural';
const AVAILABLE_SOUNDS: SoundType[] = ['off', 'white', 'rain', 'ocean', 'campfire', 'forest', 'binaural'];

export const PomodoroTimer: React.FC<PomodoroTimerProps> = ({ tasks, onTimerComplete }) => {
  const [activeTaskId, setActiveTaskId] = useState('');
  const [timeLeft, setTimeLeft] = useState(25 * 60); // 25 minutes default
  const [isRunning, setIsRunning] = useState(false);
  const [sound, setSound] = useState<SoundType>('off');
  const [preset, setPreset] = useState(25); // 25 or 50
  const [focusMode, setFocusMode] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const wakeLockRef = useRef<any>(null);

  const MOTIVATIONAL_QUOTES = [
    "Focus is a muscle, and you are building it right now.",
    "Deep work produces rare and valuable outcomes.",
    "One task at a time. Clear the noise.",
    "Your future self will thank you for this focus session.",
    "Action is the foundational key to all success.",
    "Stay with the breath. Stay with the work."
  ];

  // Rotate motivational quotes
  useEffect(() => {
    let interval: any = null;
    if (focusMode && isRunning) {
      interval = setInterval(() => {
        setQuoteIndex(prev => (prev + 1) % MOTIVATIONAL_QUOTES.length);
      }, 30000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [focusMode, isRunning]);

  // Request Wake Lock to prevent screen sleep
  useEffect(() => {
    const requestWakeLock = async () => {
      if ('wakeLock' in navigator && focusMode && isRunning) {
        try {
          const lock = await (navigator as any).wakeLock.request('screen');
          wakeLockRef.current = lock;
        } catch (err) {
          console.warn('Screen wake lock failed:', err);
        }
      }
    };

    const releaseWakeLock = async () => {
      if (wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch (err) {
          console.warn('Screen wake lock release failed:', err);
        }
      }
    };

    if (focusMode && isRunning) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }

    return () => {
      releaseWakeLock();
    };
  }, [focusMode, isRunning]);

  const timerIntervalRef = useRef<any>(null);
  const endTimeRef = useRef<number | null>(null);
  
  // Web Audio Context references for ambient sound synthesis
  const audioCtxRef = useRef<AudioContext | null>(null);
  const noiseSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const lfoRef = useRef<OscillatorNode | null>(null);
  const binauralOscLRef = useRef<OscillatorNode | null>(null);
  const binauralOscRRef = useRef<OscillatorNode | null>(null);

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
      // Record the absolute end timestamp
      endTimeRef.current = Date.now() + (timeLeft * 1000);

      timerIntervalRef.current = setInterval(() => {
        if (endTimeRef.current) {
          const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
          setTimeLeft(remaining);
          if (remaining <= 0) {
            handleComplete();
          }
        }
      }, 200); // Check 5 times per second to guarantee high responsiveness
    } else {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
      endTimeRef.current = null;
    }

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [isRunning]);

  // Synchronize timer and resume AudioContext immediately on wake-up or focus
  useEffect(() => {
    const handleWakeUp = () => {
      if (isRunning && endTimeRef.current) {
        const remaining = Math.max(0, Math.ceil((endTimeRef.current - Date.now()) / 1000));
        setTimeLeft(remaining);
        if (remaining <= 0) {
          handleComplete();
        }
      }
      
      // Auto-resume audio contexts suspended by iOS background policies
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume().catch((err) => console.warn('AudioContext resume failed:', err));
      }
    };

    window.addEventListener('visibilitychange', handleWakeUp);
    window.addEventListener('focus', handleWakeUp);
    
    return () => {
      window.removeEventListener('visibilitychange', handleWakeUp);
      window.removeEventListener('focus', handleWakeUp);
    };
  }, [isRunning]);

  // Sync native iOS lock screen media controls
  useEffect(() => {
    if ('mediaSession' in navigator && isRunning) {
      const activeTask = tasks.find(t => t._id === activeTaskId);
      navigator.mediaSession.metadata = new MediaMetadata({
        title: activeTask ? activeTask.title : 'General Focus Session',
        artist: 'Kortex by Keshav',
        album: 'Focus Pomodoro Tracker'
      });
      navigator.mediaSession.setActionHandler('play', () => setIsRunning(true));
      navigator.mediaSession.setActionHandler('pause', () => setIsRunning(false));
    }
  }, [isRunning, activeTaskId, tasks]);

  // Request notification permissions
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Handle Audio State triggers on Sound state changes
  useEffect(() => {
    if (isRunning && sound !== 'off') {
      startAudio();
    } else {
      stopAudio();
    }
    return () => stopAudio();
  }, [sound, isRunning]);

  const playChime = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(830.61, ctx.currentTime); // Ab5
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 1.2); // E5
      
      gain.gain.setValueAtTime(0.4, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.5);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start();
      osc.stop(ctx.currentTime + 1.5);
    } catch (err) {
      console.warn('Failed to play completion chime:', err);
    }
  };

  const handleComplete = () => {
    setIsRunning(false);
    stopAudio();
    setSound('off');

    // Play pleasant completion bell chime
    playChime();

    // Trigger local push notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const activeTask = tasks.find(t => t._id === activeTaskId);
      new Notification('Focus Session Complete! 🎯', {
        body: activeTask ? `Finished: ${activeTask.title}` : 'Your focus session completed. Time to take a break!',
        tag: 'kortex-timer-complete'
      });
    }
    
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

  // --- HTML5 Web Audio Ambient Sound Synthesis ---
  const startAudio = () => {
    stopAudio(); // Ensure clean start

    try {
      // 1. Initialize Audio Context
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioCtx();
      audioCtxRef.current = audioCtx;

      // 2. Create Gain node (volume)
      const gainNode = audioCtx.createGain();
      const defaultVol = sound === 'binaural' ? 0.04 : 0.08;
      gainNode.gain.setValueAtTime(defaultVol, audioCtx.currentTime); // keep volume low/ambient
      gainNodeRef.current = gainNode;

      if (sound === 'binaural') {
        // Binaural Beats: 200Hz Left, 210Hz Right -> 10Hz Alpha Focus frequency
        const oscL = audioCtx.createOscillator();
        oscL.type = 'sine';
        oscL.frequency.setValueAtTime(200, audioCtx.currentTime);

        const oscR = audioCtx.createOscillator();
        oscR.type = 'sine';
        oscR.frequency.setValueAtTime(210, audioCtx.currentTime);

        const pannerL = audioCtx.createStereoPanner();
        pannerL.pan.setValueAtTime(-1, audioCtx.currentTime);

        const pannerR = audioCtx.createStereoPanner();
        pannerR.pan.setValueAtTime(1, audioCtx.currentTime);

        oscL.connect(pannerL);
        pannerL.connect(gainNode);

        oscR.connect(pannerR);
        pannerR.connect(gainNode);

        oscL.start();
        oscR.start();

        binauralOscLRef.current = oscL;
        binauralOscRRef.current = oscR;

        gainNode.connect(audioCtx.destination);
      } else {
        // Create Audio buffer for noise
        const bufferSize = 2 * audioCtx.sampleRate;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);

        if (sound === 'white') {
          // Pure random values (white noise)
          for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
          }
        } else if (sound === 'rain' || sound === 'ocean') {
          // Brownian noise (Rain rumble/ocean wash)
          let lastOut = 0.0;
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            output[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = output[i];
            output[i] *= 3.5;
          }
        } else if (sound === 'campfire') {
          // Brownian fireplace rumble + randomized wood ember pops
          let lastOut = 0.0;
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            const brown = (lastOut + (0.02 * white)) / 1.02;
            lastOut = brown;

            let crackle = 0.0;
            if (Math.random() < 0.00018) {
              crackle = (Math.random() * 2 - 1) * 0.7; // sharp fire snap
            }
            output[i] = (brown * 1.8) + crackle;
          }
        } else if (sound === 'forest') {
          // Soft pink noise for wind rustling leaves
          let lastOut = 0.0;
          for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            const pink = (lastOut + (0.05 * white)) / 1.05;
            lastOut = pink;
            output[i] = pink * 2.2;
          }
        }

        const noiseSource = audioCtx.createBufferSource();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        noiseSourceRef.current = noiseSource;

        if (sound === 'ocean' || sound === 'forest') {
          // Ambient swells: modulate gain volume with slow LFO oscillations
          const lfo = audioCtx.createOscillator();
          lfo.type = 'sine';
          lfo.frequency.setValueAtTime(sound === 'ocean' ? 0.08 : 0.03, audioCtx.currentTime); // Ocean 12s, Forest Wind 33s

          const lfoGain = audioCtx.createGain();
          lfoGain.gain.setValueAtTime(0.04, audioCtx.currentTime);

          lfo.connect(lfoGain);
          lfoGain.connect(gainNode.gain);
          lfo.start();
          lfoRef.current = lfo;
        }

        noiseSource.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        noiseSource.start();
      }
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
      if (binauralOscLRef.current) {
        try { binauralOscLRef.current.stop(); } catch (e) {}
        binauralOscLRef.current.disconnect();
      }
      if (binauralOscRRef.current) {
        try { binauralOscRRef.current.stop(); } catch (e) {}
        binauralOscRRef.current.disconnect();
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
    binauralOscLRef.current = null;
    binauralOscRRef.current = null;
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
      <div className="flex items-center justify-between w-full select-none">
        <div className="flex items-center gap-1.5 text-xs text-indigo-400 font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 animate-pulse" />
          <span>Focus Pomodoro</span>
        </div>
        <button
          onClick={() => setFocusMode(true)}
          className="text-neutral-500 hover:text-neutral-300 p-1 rounded-md cursor-pointer hover:bg-neutral-800 transition-colors"
          title="Enter Full Screen Focus Mode"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
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
          {AVAILABLE_SOUNDS.map((s) => (
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

      {/* Focus Mode Full-Screen Overlay */}
      {focusMode && (
        <div className="fixed inset-0 bg-neutral-950/98 backdrop-blur-md z-50 flex flex-col items-center justify-center p-6 text-center select-none animate-fadeIn">
          {/* Close button */}
          <button
            onClick={() => setFocusMode(false)}
            className="absolute top-6 right-6 p-2 rounded-full bg-neutral-900 border border-white/5 text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800 cursor-pointer transition-colors"
            title="Exit Focus Mode"
          >
            <Minimize2 className="w-5 h-5" />
          </button>

          {/* Sparkles active indicator */}
          <div className="flex items-center gap-1.5 text-[10px] text-indigo-400 font-bold uppercase tracking-widest animate-pulse mb-6">
            <Sparkles className="w-4 h-4" />
            <span>Deep Focus Active</span>
          </div>

          {/* Large Countdown */}
          <div className="text-8xl font-black text-neutral-100 font-mono tracking-tight my-4">
            {formatTime(timeLeft)}
          </div>

          {/* Active Goal */}
          <div className="max-w-md mt-2 mb-8">
            <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">Active Focus Task</p>
            <h3 className="text-lg font-bold text-neutral-200 mt-1 select-text">
              {tasks.find(t => t._id === activeTaskId)?.title || 'General Deep Work'}
            </h3>
          </div>

          {/* Motivational Quote */}
          <div className="h-12 flex items-center justify-center max-w-sm mb-12">
            <p className="text-xs italic text-neutral-400 font-medium">
              "{MOTIVATIONAL_QUOTES[quoteIndex]}"
            </p>
          </div>

          {/* Sound Controls in Focus Mode */}
          <div className="flex items-center gap-3 bg-neutral-900/60 p-3 rounded-2xl border border-white/5 mb-8">
            <span className="text-[10px] text-neutral-500 font-bold uppercase tracking-wider">Ambient:</span>
            <div className="flex gap-1.5">
              {AVAILABLE_SOUNDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSound(s)}
                  className={`px-3 py-1 text-[10px] font-bold rounded-lg capitalize cursor-pointer transition-all ${
                    sound === s 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/10' 
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Timer Action Controls */}
          <div className="flex items-center gap-4">
            <button
              onClick={handleTogglePlay}
              className={`w-14 h-14 rounded-full flex items-center justify-center text-white cursor-pointer shadow-lg transition-transform hover:scale-105 ${
                isRunning 
                  ? 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/15' 
                  : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/15'
              }`}
            >
              {isRunning ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 pl-0.5" />}
            </button>
            <button
              onClick={handleReset}
              className="w-14 h-14 rounded-full bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 flex items-center justify-center cursor-pointer border border-white/5 transition-all"
              title="Reset timer"
            >
              <RotateCcw className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
