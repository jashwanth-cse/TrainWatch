import { Platform, AppState, type AppStateStatus } from 'react-native';
import * as Network from 'expo-network';
import * as IntentLauncher from 'expo-intent-launcher';

export interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean;
  networkType?: string;
}

const CONNECTIVITY_PROBE_URL = 'https://connectivitycheck.gstatic.com/generate_204';
const FALLBACK_PROBE_URL = 'https://www.google.com/generate_204';
const PROBE_TIMEOUT_MS = 3500;

let cachedStatus: NetworkStatus = {
  isConnected: true,
  isInternetReachable: true,
};

type NetworkListener = (status: NetworkStatus) => void;
const listeners = new Set<NetworkListener>();
let monitorInterval: ReturnType<typeof setInterval> | null = null;
let isMonitoring = false;

/**
 * Pings Google's captive portal / reachability endpoints (generate_204)
 * to verify genuine end-to-end internet connectivity.
 */
export async function pingInternetReachability(timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  const tryUrl = async (url: string): Promise<boolean> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'HEAD',
        cache: 'no-cache',
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.status === 204 || response.status === 200;
    } catch {
      clearTimeout(timer);
      return false;
    }
  };

  const primarySuccess = await tryUrl(CONNECTIVITY_PROBE_URL);
  if (primarySuccess) return true;

  return await tryUrl(FALLBACK_PROBE_URL);
}

/**
 * Checks current network connectivity and internet reachability.
 */
export async function checkNetworkStatus(): Promise<NetworkStatus> {
  try {
    const state = await Network.getNetworkStateAsync();

    if (!state.isConnected) {
      cachedStatus = {
        isConnected: false,
        isInternetReachable: false,
        networkType: state.type ? String(state.type) : undefined,
      };
      notifyListeners(cachedStatus);
      return cachedStatus;
    }

    // Double-check real internet reachability via captive portal ping
    const isReachable = await pingInternetReachability();

    cachedStatus = {
      isConnected: true,
      isInternetReachable: isReachable,
      networkType: state.type ? String(state.type) : undefined,
    };
    notifyListeners(cachedStatus);
    return cachedStatus;
  } catch {
    // If Network module throws, fallback to direct ping
    const isReachable = await pingInternetReachability();
    cachedStatus = {
      isConnected: isReachable,
      isInternetReachable: isReachable,
    };
    notifyListeners(cachedStatus);
    return cachedStatus;
  }
}

/**
 * Returns the latest known network status synchronously.
 */
export function getCachedNetworkStatus(): NetworkStatus {
  return { ...cachedStatus };
}

/**
 * Opens the Android system network or Wi-Fi settings so users can toggle mobile data or Wi-Fi.
 */
export async function openNetworkSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    // Android 10+ (API 29+) Quick Internet Connectivity Bottom Sheet Panel
    await IntentLauncher.startActivityAsync('android.settings.panel.action.INTERNET_CONNECTIVITY');
  } catch {
    try {
      // Fallback to Wireless & Network Settings
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.WIRELESS_SETTINGS);
    } catch {
      try {
        // Fallback to Wi-Fi Settings
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.WIFI_SETTINGS);
      } catch {
        // Fallback to Main Settings
        await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.SETTINGS);
      }
    }
  }
}

function notifyListeners(status: NetworkStatus): void {
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // Prevent individual listener failures from crashing dispatcher
    }
  }
}

/**
 * Subscribe to network status updates. Automatically starts foreground monitoring.
 */
export function addNetworkListener(listener: NetworkListener): () => void {
  listeners.add(listener);
  // Send current cached state immediately
  listener(cachedStatus);

  if (!isMonitoring) {
    startNetworkMonitoring();
  }

  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stopNetworkMonitoring();
    }
  };
}

function startNetworkMonitoring(): void {
  if (isMonitoring) return;
  isMonitoring = true;

  // Poll every 4.5 seconds when active
  monitorInterval = setInterval(() => {
    void checkNetworkStatus();
  }, 4500);

  // Immediate check when app comes back to foreground (e.g. after toggling Wi-Fi in settings)
  const appStateSub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      void checkNetworkStatus();
    }
  });

  // Store cleanup
  (startNetworkMonitoring as any)._appStateSub = appStateSub;
}

function stopNetworkMonitoring(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
  const sub = (startNetworkMonitoring as any)._appStateSub;
  if (sub && typeof sub.remove === 'function') {
    sub.remove();
    (startNetworkMonitoring as any)._appStateSub = null;
  }
  isMonitoring = false;
}
