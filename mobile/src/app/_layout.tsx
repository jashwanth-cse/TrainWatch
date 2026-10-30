import React, { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../services/AuthContext';
import { SplashScreen } from '../components/SplashScreen';
import { initBackendWarmup } from '../services/backendWarmupService';
import {
  initializeNotificationChannel,
  checkNotificationPermission,
  requestNotificationPermissionsAndRegisterDevice,
} from '../services/notificationService';

const AppNavigator: React.FC = () => {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="home" />
      <Stack.Screen name="results" />
      <Stack.Screen name="alerts" />
    </Stack>
  );
};

const AppContent: React.FC = () => {
  const { isLoading } = useAuth();
  const [showSplash, setShowSplash] = useState(true);
  const handleAnimationComplete = useCallback(() => setShowSplash(false), []);

  return (
    <>
      <AppNavigator />
      {showSplash && (
        <SplashScreen
          readyToDismiss={!isLoading}
          onAnimationComplete={handleAnimationComplete}
        />
      )}
    </>
  );
};

/** Provides device identity, smooth splash transition, and routes for TrainWatch. */
export default function RootLayout() {
  useEffect(() => {
    const unsubscribe = initBackendWarmup();
    initializeNotificationChannel().catch(() => {});
    checkNotificationPermission().then((granted) => {
      if (granted) {
        requestNotificationPermissionsAndRegisterDevice().catch(() => {});
      }
    }).catch(() => {});
    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
