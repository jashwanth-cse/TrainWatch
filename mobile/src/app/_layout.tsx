import React, { useCallback, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Constants from 'expo-constants';
import { AuthProvider, useAuth } from '../services/AuthContext';
import { SplashScreen } from '../components/SplashScreen';
import { initBackendWarmup } from '../services/backendWarmupService';
import { checkNetworkStatus } from '../services/networkService';
import {
  initializeNotificationChannel,
  checkNotificationPermission,
  requestNotificationPermissionsAndRegisterDevice,
} from '../services/notificationService';
import {
  checkForAppUpdate,
  checkPostUpdateToast,
  dismissUpdate,
  downloadAndInstallApk,
  type AppReleaseInfo,
} from '../services/updateService';
import { UpdatePromptModal } from '../components/UpdatePromptModal';
import { UpdateToast } from '../components/UpdateToast';

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

  // In-app update state
  const currentVersion = Constants.expoConfig?.version || '1.0.0';
  const [updateRelease, setUpdateRelease] = useState<AppReleaseInfo | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [bytesWritten, setBytesWritten] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Post-update confirmation toast state
  const [showToast, setShowToast] = useState(false);
  const [toastVersion, setToastVersion] = useState(currentVersion);

  useEffect(() => {
    // Proactively verify internet reachability on startup via Google captive portal
    checkNetworkStatus().catch(() => {});

    // Check for post-update toast banner
    checkPostUpdateToast(currentVersion)
      .then((res) => {
        if (res.isNewVersion) {
          setToastVersion(res.currentVersion);
          setShowToast(true);
        }
      })
      .catch(() => {});

    // Check for newer releases on GitHub
    checkForAppUpdate({ currentVersion })
      .then((res) => {
        if (res.hasUpdate && res.release && !res.isDismissed) {
          setUpdateRelease(res.release);
          setShowUpdateModal(true);
        }
      })
      .catch(() => {});
  }, [currentVersion]);

  const handleDismissUpdate = useCallback(() => {
    setShowUpdateModal(false);
    if (updateRelease) {
      dismissUpdate(updateRelease.version).catch(() => {});
    }
  }, [updateRelease]);

  const handleStartUpdate = useCallback(async () => {
    if (!updateRelease) return;
    setIsDownloading(true);
    setUpdateError(null);
    setDownloadProgress(0);
    setBytesWritten(0);
    setTotalBytes(0);

    const result = await downloadAndInstallApk(
      updateRelease.apkDownloadUrl,
      (progress, total, written) => {
        setDownloadProgress(progress);
        setTotalBytes(total);
        setBytesWritten(written);
      }
    );

    if (!result.success) {
      setIsDownloading(false);
      setUpdateError(result.error || 'Failed to install update');
    }
  }, [updateRelease]);

  return (
    <>
      <AppNavigator />
      {showSplash && (
        <SplashScreen
          readyToDismiss={!isLoading}
          onAnimationComplete={handleAnimationComplete}
        />
      )}
      <UpdatePromptModal
        visible={showUpdateModal && !showSplash}
        release={updateRelease}
        currentVersion={currentVersion}
        onDismiss={handleDismissUpdate}
        onUpdate={handleStartUpdate}
        isDownloading={isDownloading}
        downloadProgress={downloadProgress}
        bytesWritten={bytesWritten}
        totalBytes={totalBytes}
        errorMessage={updateError}
      />
      <UpdateToast
        visible={showToast && !showSplash}
        version={toastVersion}
        onDismiss={() => setShowToast(false)}
      />
    </>
  );
};

/** Provides device identity, smooth splash transition, and routes for TrainWatch. */
export default function RootLayout() {
  useEffect(() => {
    const unsubscribe = initBackendWarmup();
    initializeNotificationChannel().catch(() => {});
    checkNotificationPermission()
      .then((granted) => {
        if (granted) {
          requestNotificationPermissionsAndRegisterDevice().catch(() => {});
        }
      })
      .catch(() => {});
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
