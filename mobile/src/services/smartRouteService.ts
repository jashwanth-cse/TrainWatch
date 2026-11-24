import AsyncStorage from '@react-native-async-storage/async-storage';
import { sanitizeError } from '../utils/errorUtils';

export function normalizeDateToIso(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split(/[-/]/);
  if (parts.length === 3) {
    if (parts[0].length <= 2 && parts[2].length === 4) {
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
    if (parts[0].length === 4) {
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    }
  }
  return dateStr;
}

export function normalizeTravelClass(rawClass: string | null | undefined): string {
  if (!rawClass) return 'SL';
  const clean = rawClass.trim().toUpperCase();
  if (clean === '3AC') return '3A';
  if (clean === '2AC') return '2A';
  if (clean === '1AC') return '1A';
  return clean;
}

export function getSmartRoutesApiBaseUrl(): string {
  const url =
    process.env.EXPO_PUBLIC_TRAINWATCH_API_URL ||
    process.env.EXPO_PUBLIC_TRANSPORT_SERVICE_URL;
  if (url && url.trim()) {
    return url.trim().replace(/\/+$/, '');
  }
  return '';
}

export interface SubLeg {
  leg_number: number;
  train_no: string;
  train_name: string;
  from_station: string;
  to_station: string;
  travel_class: string;
  quota: string;
  status: string;
  raw_status: string;
  position: number | null;
  fare: number | null;
  departure_time: string | null;
  arrival_time: string | null;
  duration_minutes: number;
  distance_km: number;
}

export interface SmartRouteSolution {
  solution_id: string;
  tier: string;
  legs: SubLeg[];
  total_fare: number | null;
  fare_surcharge: number;
  fare_surcharge_pct: number;
  total_duration_minutes: number;
  boarding_station: string | null;
  is_confirmed: boolean;
  is_rac: boolean;
  recommendation_score: number;
  split_stations: string[];
}

export interface SmartRoutesResultData {
  train_no: string;
  train_name: string;
  origin: string;
  destination: string;
  journey_date: string;
  travel_class: string;
  journey_duration_hours: number;
  journey_distance_km: number;
  max_leg_horizon: number;
  direct_status: string | null;
  direct_fare: number | null;
  solutions: SmartRouteSolution[];
  execution_time_ms: number;
  stations_evaluated_count: number;
  queries_executed_count: number;
}

export interface FetchSmartRoutesParams {
  trainNo: string;
  origin: string;
  destination: string;
  journeyDate: string; // YYYY-MM-DD
  travelClass: string; // SL, 3A, 2A, etc.
  quota?: string; // GN
  forceRefresh?: boolean;
}

export interface SmartRouteFetchResult {
  data: SmartRoutesResultData;
  isFromCache: boolean;
  cachedAt: number;
  expiresAt: number;
  remainingSeconds: number;
  rateLimited?: boolean;
}

interface CacheEntry {
  data: SmartRoutesResultData;
  cachedAt: number;
  expiresAt: number;
}

export const SMART_ROUTE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
const CACHE_STORAGE_PREFIX = 'trainwatch:smart_route:';

// In-memory cache for instant microsecond retrieval
const memoryCache = new Map<string, CacheEntry>();

// In-flight request coalescing to prevent duplicate concurrent network requests
const inFlightRequests = new Map<string, Promise<SmartRoutesResultData>>();

export function buildSmartRouteCacheKey(params: {
  trainNo: string;
  origin: string;
  destination: string;
  journeyDate: string;
  travelClass: string;
  quota?: string;
}): string {
  const q = (params.quota || 'GN').trim().toUpperCase();
  const dateIso = normalizeDateToIso(params.journeyDate);
  const cls = normalizeTravelClass(params.travelClass);
  return `${params.trainNo.trim()}_${params.origin.trim().toUpperCase()}_${params.destination.trim().toUpperCase()}_${dateIso}_${cls}_${q}`;
}

/**
 * Fetch smart route solutions with a strict 5-minute client-side cache.
 * Protects railway servers against repeated duplicate calls within the 5-minute window.
 */
export async function fetchSmartRoutes(
  params: FetchSmartRoutesParams
): Promise<SmartRouteFetchResult> {
  const cacheKey = buildSmartRouteCacheKey(params);
  const now = Date.now();

  // 1. Check in-memory cache first
  let cached = memoryCache.get(cacheKey);

  // 2. If not in memory, attempt reading from persistent storage
  if (!cached) {
    try {
      const persisted = await AsyncStorage.getItem(CACHE_STORAGE_PREFIX + cacheKey);
      if (persisted) {
        const parsed: CacheEntry = JSON.parse(persisted);
        if (parsed && typeof parsed.expiresAt === 'number' && parsed.data) {
          cached = parsed;
          memoryCache.set(cacheKey, parsed);
        }
      }
    } catch {
      // Ignore async storage read errors
    }
  }

  // 3. Evaluate cache freshness
  if (cached && now < cached.expiresAt) {
    const remaining = Math.max(0, Math.ceil((cached.expiresAt - now) / 1000));

    // If user attempted a force refresh but the 5-minute window has NOT yet elapsed:
    // Rate limit the refresh to protect the backend and inform the user.
    if (params.forceRefresh) {
      return {
        data: cached.data,
        isFromCache: true,
        cachedAt: cached.cachedAt,
        expiresAt: cached.expiresAt,
        remainingSeconds: remaining,
        rateLimited: true,
      };
    }

    return {
      data: cached.data,
      isFromCache: true,
      cachedAt: cached.cachedAt,
      expiresAt: cached.expiresAt,
      remainingSeconds: remaining,
    };
  }

  // 4. In-flight request coalescing (if identical request is already running)
  let requestPromise = inFlightRequests.get(cacheKey);
  if (!requestPromise) {
    requestPromise = (async () => {
      const baseUrl = getSmartRoutesApiBaseUrl();
      if (!baseUrl) {
        throw new Error('API service endpoint is not configured. Please check environment configuration.');
      }

      const url = `${baseUrl}/api/v1/trains/smart-routes`;
      const body = {
        train_no: params.trainNo.trim(),
        origin: params.origin.trim().toUpperCase(),
        destination: params.destination.trim().toUpperCase(),
        journey_date: normalizeDateToIso(params.journeyDate),
        travel_class: normalizeTravelClass(params.travelClass),
        quota: (params.quota || 'GN').trim().toUpperCase(),
      };

      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (netErr) {
        const sanitized = sanitizeError(netErr);
        throw new Error(sanitized.userMessage);
      }

      if (!response.ok) {
        let errorMsg = `Smart routing error (${response.status})`;
        try {
          const errJson = await response.json();
          if (errJson?.detail) errorMsg = errJson.detail;
          else if (errJson?.message) errorMsg = errJson.message;
        } catch {
          // Fallback
        }
        const sanitized = sanitizeError(new Error(errorMsg));
        throw new Error(sanitized.userMessage);
      }

      const json = await response.json();
      if (!json.success || !json.data) {
        throw new Error(json.message || 'No smart routes discovered for this train.');
      }

      return json.data as SmartRoutesResultData;
    })();

    inFlightRequests.set(cacheKey, requestPromise);
  }

  let data: SmartRoutesResultData;
  try {
    data = await requestPromise;
  } finally {
    inFlightRequests.delete(cacheKey);
  }

  // 5. Save to 5-minute cache
  const cachedAt = Date.now();
  const expiresAt = cachedAt + SMART_ROUTE_CACHE_TTL_MS;
  const newEntry: CacheEntry = { data, cachedAt, expiresAt };

  memoryCache.set(cacheKey, newEntry);
  AsyncStorage.setItem(CACHE_STORAGE_PREFIX + cacheKey, JSON.stringify(newEntry)).catch(() => {});

  return {
    data,
    isFromCache: false,
    cachedAt,
    expiresAt,
    remainingSeconds: Math.ceil(SMART_ROUTE_CACHE_TTL_MS / 1000),
  };
}

/**
 * Clear all smart route cache entries (useful for testing or full app logout).
 */
export async function clearSmartRouteCache(): Promise<void> {
  memoryCache.clear();
  inFlightRequests.clear();
  try {
    const keys = await AsyncStorage.getAllKeys();
    const smartRouteKeys = keys.filter((k) => k.startsWith(CACHE_STORAGE_PREFIX));
    if (smartRouteKeys.length > 0) {
      await AsyncStorage.multiRemove(smartRouteKeys);
    }
  } catch {
    // Ignore errors
  }
}
