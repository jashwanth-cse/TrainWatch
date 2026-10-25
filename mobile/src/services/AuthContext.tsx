import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthState } from '../types/auth';
import { authService } from '../services/authService';

interface AuthContextValue extends AuthState {
  getDeviceId: () => Promise<string>;
  resetDeviceSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        const user = await authService.loadPersistedSession();
        if (active) {
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            error: null,
          });
        }
      } catch (err: unknown) {
        if (active) {
          const message = err instanceof Error ? err.message : 'Failed to initialize session';
          setState({
            user: null,
            isAuthenticated: false,
            isLoading: false,
            error: message,
          });
        }
      }
    };

    bootstrap();

    return () => {
      active = false;
    };
  }, []);

  const getDeviceId = async (): Promise<string> => {
    return authService.getDeviceId();
  };

  const resetDeviceSession = async (): Promise<void> => {
    await authService.signOut();
    const user = authService.getCurrentUser();
    setState({
      user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
  };

  return (
    <AuthContext.Provider value={{ ...state, getDeviceId, resetDeviceSession }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
