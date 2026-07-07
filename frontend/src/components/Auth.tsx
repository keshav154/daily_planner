import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { 
  Mail, Lock, Sparkles, Loader2, User, Eye, EyeOff, Globe, Clock, Zap, Sun, Moon, Sunrise, Sunset 
} from 'lucide-react';

export const Auth: React.FC = () => {
  const { login, register, updateUser } = useAuth();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Onboarding Wizard State
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(1);
  const [timezone, setTimezone] = useState('');
  const [peakEnergy, setPeakEnergy] = useState<'morning' | 'afternoon' | 'evening' | 'night'>('morning');
  const [workingStart, setWorkingStart] = useState('09:00');
  const [workingEnd, setWorkingEnd] = useState('17:00');

  // Left Panel Features cycle
  const [activeFeature, setActiveFeature] = useState(0);
  const features = [
    {
      title: "Chain-of-Thought Planner",
      desc: "Our agent plans your schedule, critiques potential overloads, and refines tasks autonomously."
    },
    {
      title: "Dynamic Second Brain Memory",
      desc: "Automatically records patterns and habits, consolidating observations to optimize your focus hours."
    },
    {
      title: "Multi-Agent Boardroom",
      desc: "Watch specialised Scrum, Productivity, and Calendar agents debate to form daily consensus plans."
    }
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveFeature((prev) => (prev + 1) % features.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  // Timezone Auto-Detect
  useEffect(() => {
    setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, []);

  // Password strength checker
  const getPasswordStrength = () => {
    if (!password) return { label: '', color: 'bg-neutral-800', percent: 'w-0' };
    if (password.length < 6) return { label: 'Weak', color: 'bg-red-500', percent: 'w-1/3' };
    if (password.length < 10) return { label: 'Medium', color: 'bg-amber-500', percent: 'w-2/3' };
    return { label: 'Strong', color: 'bg-emerald-500', percent: 'w-full' };
  };
  const strength = getPasswordStrength();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }
    if (!isLogin && !name) {
      setError('Please enter your name');
      return;
    }
    if (!isLogin && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await login(email, password);
      } else {
        await register(email, password, name, timezone);
        setShowOnboarding(true);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleOnboardingSubmit = async () => {
    setLoading(true);
    try {
      const response = await api.put('/auth/me', {
        timezone,
        preferences: {
          workingHoursStart: workingStart,
          workingHoursEnd: workingEnd,
          peakEnergyTime: peakEnergy
        }
      });
      // Synchronise Context State
      updateUser(response.data);
    } catch (err: any) {
      alert('Failed to save onboarding settings: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  if (showOnboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-950 p-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-violet-500/10 rounded-full blur-[100px] pointer-events-none"></div>

        <div className="w-full max-w-lg glass-panel rounded-3xl p-8 border border-white/5 relative z-10 shadow-2xl flex flex-col space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-white/5">
            <div>
              <span className="text-[9px] font-bold tracking-wider text-indigo-400 uppercase">Onboarding Setup</span>
              <h2 className="text-lg font-bold text-neutral-100">Configure Your Second Brain</h2>
            </div>
            <div className="text-xs text-neutral-500 font-bold">
              Step {onboardingStep} of 3
            </div>
          </div>

          {/* Stepper Progress Bar */}
          <div className="flex gap-2">
            {[1, 2, 3].map((s) => (
              <div 
                key={s} 
                className={`h-1 flex-1 rounded-full transition-all duration-300 ${
                  s <= onboardingStep ? 'bg-indigo-500' : 'bg-neutral-800'
                }`}
              />
            ))}
          </div>

          <div className="min-h-[220px] py-4 flex flex-col justify-center">
            {/* STEP 1: Timezone */}
            {onboardingStep === 1 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-200">Confirm Your Timezone</h3>
                    <p className="text-xs text-neutral-500">Kortex logs and schedules are aligned to your timezone.</p>
                  </div>
                </div>

                <div className="relative pt-2">
                  <select 
                    value={timezone} 
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full pl-4 pr-10 py-3 rounded-lg text-sm text-neutral-100 bg-neutral-900 border border-white/5 focus:border-indigo-500 outline-none cursor-pointer"
                  >
                    <option value="UTC">UTC (Universal Coordinated Time)</option>
                    <option value="Asia/Kolkata">Asia/Kolkata (IST - GMT+5:30)</option>
                    <option value="America/New_York">America/New_York (EST - GMT-5:00)</option>
                    <option value="America/Los_Angeles">America/Los_Angeles (PST - GMT-8:00)</option>
                    <option value="Europe/London">Europe/London (GMT)</option>
                    <option value="Europe/Paris">Europe/Paris (CET - GMT+1:00)</option>
                    <option value="Asia/Singapore">Asia/Singapore (SGT - GMT+8:00)</option>
                  </select>
                </div>
              </div>
            )}

            {/* STEP 2: Peak Energy Selector */}
            {onboardingStep === 2 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-200">When is your Peak Energy?</h3>
                    <p className="text-xs text-neutral-500">Our agent will schedule demanding tasks during this period.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2">
                  {[
                    { id: 'morning', label: 'Morning', icon: Sunrise, time: '6 AM - 12 PM' },
                    { id: 'afternoon', label: 'Afternoon', icon: Sun, time: '12 PM - 5 PM' },
                    { id: 'evening', label: 'Evening', icon: Sunset, time: '5 PM - 9 PM' },
                    { id: 'night', label: 'Night', icon: Moon, time: '9 PM - 6 AM' }
                  ].map((item) => {
                    const Icon = item.icon;
                    const isSelected = peakEnergy === item.id;
                    return (
                      <button
                        key={item.id}
                        onClick={() => setPeakEnergy(item.id as any)}
                        className={`p-4 rounded-xl border text-left flex flex-col space-y-2 cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-indigo-950/20 border-indigo-500 text-indigo-300' 
                            : 'bg-neutral-900/60 border-white/5 hover:border-white/10 text-neutral-400'
                        }`}
                      >
                        <Icon className={`w-5 h-5 ${isSelected ? 'text-indigo-400' : 'text-neutral-500'}`} />
                        <div>
                          <div className="text-xs font-bold text-neutral-200">{item.label}</div>
                          <div className="text-[10px] text-neutral-500 font-semibold">{item.time}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 3: Working Hours */}
            {onboardingStep === 3 && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-neutral-200">Define Your Working Hours</h3>
                    <p className="text-xs text-neutral-500">Autonomous planning and reflection occur within these boundaries.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-neutral-500 mb-1.5">Start Time</label>
                    <input 
                      type="time" 
                      value={workingStart} 
                      onChange={(e) => setWorkingStart(e.target.value)}
                      className="w-full p-3 rounded-lg text-sm text-neutral-100 bg-neutral-900 border border-white/5 focus:border-indigo-500 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-bold text-neutral-500 mb-1.5">End Time</label>
                    <input 
                      type="time" 
                      value={workingEnd} 
                      onChange={(e) => setWorkingEnd(e.target.value)}
                      className="w-full p-3 rounded-lg text-sm text-neutral-100 bg-neutral-900 border border-white/5 focus:border-indigo-500 outline-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Controls Footer */}
          <div className="flex gap-3 pt-4 border-t border-white/5">
            {onboardingStep > 1 && (
              <button
                onClick={() => setOnboardingStep((p) => p - 1)}
                className="px-5 py-3 border border-white/5 hover:bg-neutral-900 text-neutral-400 font-semibold text-xs rounded-xl cursor-pointer transition-colors"
              >
                Back
              </button>
            )}
            <button
              onClick={() => {
                if (onboardingStep < 3) {
                  setOnboardingStep((p) => p + 1);
                } else {
                  handleOnboardingSubmit();
                }
              }}
              disabled={loading}
              className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : onboardingStep === 3 ? (
                <>Complete Setup <Sparkles className="w-4 h-4" /></>
              ) : (
                'Continue'
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-neutral-950 font-sans relative overflow-hidden">
      
      {/* Background glow effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-indigo-900/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-violet-900/10 rounded-full blur-[120px] pointer-events-none"></div>

      <div className="flex-1 flex max-w-6xl mx-auto items-center justify-center p-4 lg:p-8 z-10">
        <div className="w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch min-h-[600px] bg-neutral-900/30 rounded-3xl border border-white/5 shadow-2xl overflow-hidden backdrop-blur-xl">
          
          {/* Left panel: Product / Branding feature deck */}
          <div className="lg:col-span-5 bg-gradient-to-br from-indigo-950/45 to-violet-950/45 p-8 flex flex-col justify-between border-r border-white/5 relative min-h-[300px] lg:min-h-full">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-md shadow-indigo-600/30">
                <Sparkles className="w-4 h-4" />
              </div>
              <span className="font-extrabold text-neutral-100 tracking-tight text-sm">Kortex</span>
            </div>

            <div className="space-y-6 my-auto pt-8">
              <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 px-3 py-1 rounded-full border border-indigo-500/10">
                AI Agentic Second Brain
              </span>
              
              {/* Feature Slideshow */}
              <div className="min-h-[120px] flex flex-col justify-center space-y-2.5">
                <h2 className="text-xl lg:text-2xl font-black text-neutral-100 leading-tight transition-all duration-300">
                  {features[activeFeature].title}
                </h2>
                <p className="text-xs text-neutral-400 leading-relaxed font-sans">
                  {features[activeFeature].desc}
                </p>
              </div>

              {/* Indicator dots */}
              <div className="flex gap-1.5">
                {features.map((_, idx) => (
                  <div
                    key={idx}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      activeFeature === idx ? 'w-6 bg-indigo-500' : 'w-1.5 bg-neutral-800'
                    }`}
                  />
                ))}
              </div>
            </div>

            <div className="text-[10px] text-neutral-500 font-semibold font-sans">
              Autonomous Planning • Continuous Reflection • Deep Memory Consolidation
            </div>
          </div>

          {/* Right panel: Auth Form */}
          <div className="lg:col-span-7 p-8 flex flex-col justify-center">
            <div className="max-w-md w-full mx-auto space-y-6">
              
              <div className="space-y-2">
                <h1 className="text-2xl font-extrabold text-neutral-100 tracking-tight">
                  {isLogin ? 'Welcome Back' : 'Create Neural Core'}
                </h1>
                <p className="text-xs text-neutral-400">
                  {isLogin ? 'Enter email and password to open Kortex daily planner.' : 'Register to configure your personalized AI agent.'}
                </p>
              </div>

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl text-center font-semibold">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                
                {/* Name field (Signup only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Your Name</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500">
                        <User className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        required
                        className="w-full pl-10 pr-4 py-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
                        placeholder="Keshav"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                {/* Email field */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Email Address</label>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500">
                      <Mail className="w-4 h-4" />
                    </span>
                    <input
                      type="email"
                      required
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>

                {/* Password field */}
                <div>
                  <div className="flex justify-between items-center mb-1.5">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400">Password</label>
                  </div>
                  <div className="relative">
                    <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500">
                      <Lock className="w-4 h-4" />
                    </span>
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      className="w-full pl-10 pr-10 py-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-neutral-500 hover:text-neutral-300 cursor-pointer"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Password Strength indicator (Signup only) */}
                  {!isLogin && password && (
                    <div className="mt-2 space-y-1">
                      <div className="flex justify-between items-center text-[9px] font-bold uppercase">
                        <span className="text-neutral-500">Password Strength</span>
                        <span className={
                          strength.label === 'Strong' ? 'text-emerald-400' :
                          strength.label === 'Medium' ? 'text-amber-400' : 'text-red-400'
                        }>{strength.label}</span>
                      </div>
                      <div className="h-1 w-full bg-neutral-800 rounded-full overflow-hidden">
                        <div className={`h-full transition-all duration-300 ${strength.color} ${strength.percent}`} />
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm Password field (Signup only) */}
                {!isLogin && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-neutral-400 mb-1.5">Confirm Password</label>
                    <div className="relative">
                      <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center text-neutral-500">
                        <Lock className="w-4 h-4" />
                      </span>
                      <input
                        type="password"
                        required
                        className="w-full pl-10 pr-4 py-3 rounded-xl text-xs text-neutral-100 placeholder-neutral-500 glass-input"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full mt-2 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl cursor-pointer transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/25 disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      {isLogin ? 'Sign In to Workspace' : 'Initialize Agent Core'}
                      <Sparkles className="w-4 h-4" />
                    </>
                  )}
                </button>

              </form>

              <div className="pt-4 border-t border-white/5 text-center">
                <button
                  type="button"
                  className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer transition-colors"
                  onClick={() => {
                    setIsLogin(!isLogin);
                    setError('');
                  }}
                >
                  {isLogin ? "Don't have an account? Create one" : 'Already configured an account? Sign in'}
                </button>
              </div>

            </div>
          </div>

        </div>
      </div>

    </div>
  );
};
