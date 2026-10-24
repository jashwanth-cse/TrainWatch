import { AppState, type AppStateStatus } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTransportApiBaseUrl } from './trainService';

export const WARMUP_STORAGE_KEY = '@trainwatch_last_backend_ping';
export const WARMUP_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes
export const WARMUP_TIMEOUT_MS = 6000; // 6 seconds

let isPinging = false;
let activePingPromise: Promise<boolean> | null = null;
let currentAppState: AppStateStatus = (AppState.currentState as AppStateStatus) || 'active';

export interface WarmupResult {
  triggered: boolean;
  success: boolean;
  reason?: 'cooldown_active' | 'already_in_flight' | 'completed' | 'failed';
}

/**
 * Checks if the backend health warmup ping is allowed based on the 10-minute cooldown.
 */
export async function canPingBackend(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(WARMUP_STORAGE_KEY);
    if (!raw) return true;
    const lastPing = parseInt(raw, 10);
    if (isNaN(lastPing)) return true;
    return Date.now() - lastPing >= WARMUP_COOLDOWN_MS;
  } catch {
    return true;
  }
}

/**
 * Asynchronously triggers a lightweight GET /health ping to wake up the serverless
 * Cloud Run instance from idle/scale-to-zero.
 *
 * Designed with intelligent production safeguards:
 * 1. 10-minute cooldown window stored persistently prevents overwhelming the backend.
 * 2. In-flight lock deduplicates concurrent calls.
 * 3. 6s AbortController timeout avoids stalled background tasks.
 * 4. Silent failure handling ensures offline / bad network states never crash or alert the user.
 */
export async function triggerBackendWarmup(options?: { force?: boolean }): Promise<WarmupResult> {
  if (isPinging && activePingPromise) {
    const success = await activePingPromise;
    return { triggered: false, success, reason: 'already_in_flight' };
  }

  const force = options?.force ?? false;
  if (!force) {
    const allowed = await canPingBackend();
    if (!allowed) {
      return { triggered: false, success: true, reason: 'cooldown_active' };
    }
  }

  isPinging = true;

  const pingTask = (async (): Promise<boolean> => {
    const baseUrl = getTransportApiBaseUrl();
    const endpoint = `${baseUrl}/health`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), WARMUP_TIMEOUT_MS);

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Client-Intent': 'warmup',
        },
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (response.ok) {
        await AsyncStorage.setItem(WARMUP_STORAGE_KEY, Date.now().toString());
        return true;
      }
      return false;
    } catch {
      clearTimeout(timer);
      return false;
    } finally {
      isPinging = false;
      activePingPromise = null;
    }
  })();

  activePingPromise = pingTask;
  const success = await pingTask;
  return {
    triggered: true,
    success,
    reason: success ? 'completed' : 'failed',
  };
}

/**
 * Initializes the backend warmup background service.
 * - Kicks off an initial check on app startup.
 * - Listens for AppState returning to 'active' and pings if cooldown has expired.
 * Returns a cleanup unsubscribe callback.
 */
export function initBackendWarmup(): () => void {
  // Initial check on app startup
  triggerBackendWarmup().catch(() => {});

  const subscription = AppState.addEventListener('change', (nextAppState) => {
    if (
      (currentAppState === 'background' || currentAppState === 'inactive') &&
      nextAppState === 'active'
    ) {
      triggerBackendWarmup().catch(() => {});
    }
    currentAppState = nextAppState;
  });

  return () => {
    subscription.remove();
  };
}
