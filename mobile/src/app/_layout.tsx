import React, { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../services/AuthContext';
import { colors } from '../theme/tokens';
import { SplashScreen } from '../components/SplashScreen';

const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!isAuthenticated}>
        <Stack.Screen name="index" />
      </Stack.Protected>
      <Stack.Protected guard={isAuthenticated}>
        <Stack.Screen name="home" />
        <Stack.Screen name="results" />
      </Stack.Protected>
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

/** Provides session state, splash transition, and protected routes for TrainWatch. */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },
});
