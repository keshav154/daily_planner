import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';

export interface IUser {
  id: string;
  email: string;
  name?: string;
  avatar?: string;
  timezone: string;
  theme?: string;
  xp?: number;
  level?: number;
  achievements?: string[];
  preferences: {
    workingHoursStart: string;
    workingHoursEnd: string;
    peakEnergyTime: 'morning' | 'afternoon' | 'evening' | 'night';
    workMode: 'office' | 'wfh';
  };
}

interface AuthContextType {
  user: IUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, registrationCode: string, name?: string, timezone?: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<IUser>) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<IUser | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [loading, setLoading] = useState(true);

  // Validate session on load
  useEffect(() => {
    const fetchProfile = async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const response = await api.get('/auth/me');
        setUser(response.data);
      } catch (error) {
        console.error('Session restoration failed:', error);
        logout();
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [token]);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/auth/login', { email, password });
      const { token: receivedToken, user: receivedUser } = response.data;
      
      localStorage.setItem('token', receivedToken);
      setToken(receivedToken);
      setUser(receivedUser);
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Authentication failed');
    }
  };

  const register = async (email: string, password: string, registrationCode: string, name?: string, timezone?: string) => {
    try {
      const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      const response = await api.post('/auth/register', { email, password, registrationCode, name, timezone: tz });
      const { token: receivedToken, user: receivedUser } = response.data;

      localStorage.setItem('token', receivedToken);
      setToken(receivedToken);
      setUser(receivedUser);
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Registration failed');
    }
  };

  const logout = () => {
    localStorage.removeItem('token');
    setToken(null);
    setUser(null);
    setLoading(false);
  };

  const updateUser = (updates: Partial<IUser>) => {
    setUser(prev => prev ? { ...prev, ...updates } : null);
  };

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
