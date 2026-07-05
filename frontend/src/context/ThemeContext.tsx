import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../services/api';
import { useAuth } from './AuthContext';

interface ThemeContextType {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, updateUser } = useAuth();
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('kortex-theme');
    return (saved === 'light' || saved === 'dark') ? saved : 'dark';
  });

  // Apply theme to HTML tag
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
      root.classList.remove('dark');
    } else {
      root.classList.add('dark');
      root.classList.remove('light');
    }
    localStorage.setItem('kortex-theme', theme);
  }, [theme]);

  // Sync theme when user logs in and user object has a defined theme
  useEffect(() => {
    if (user && user.theme && (user.theme === 'light' || user.theme === 'dark')) {
      if (user.theme !== theme) {
        setTheme(user.theme as 'dark' | 'light');
      }
    }
  }, [user]);

  const toggleTheme = async () => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);

    if (user) {
      try {
        updateUser({ theme: nextTheme });
        await api.put('/auth/me', { theme: nextTheme });
      } catch (err) {
        console.error('Failed to sync theme preference to server:', err);
      }
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
