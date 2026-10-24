import React, { createContext, useContext, useEffect, useState } from 'react';
import { AuthState } from '../types/auth';
import { authService } from '../services/authService';

interface AuthContextValue extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
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
    const bootstrap = async () => {
      try {
        const user = await authService.loadPersistedSession();
        setState({
          user,
          isAuthenticated: !!user,
          isLoading: false,
          error: null,
        });
      } catch (err: any) {
        setState({
          user: null,
          isAuthenticated: false,
          isLoading: false,
          error: err?.message || 'Failed to restore session',
        });
      }
    };
    bootstrap();
  }, []);

  const signInWithGoogle = async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const user = await authService.signInWithGoogle();
      setState({
        user,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      });
    } catch (err: any) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: err?.message || 'Google Sign-In failed',
      }));
    }
  };

  const signOut = async () => {
    await authService.signOut();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  };

  return (
    <AuthContext.Provider value={{ ...state, signInWithGoogle, signOut }}>
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
