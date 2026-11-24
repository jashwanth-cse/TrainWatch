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
  journey_date?: string;
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

export interface BookingOrderStep {
  step_number: number;
  leg_number: number;
  from_station: string;
  to_station: string;
  journey_date: string;
  departure_time: string | null;
  raw_status: string;
  available_seats: number | null;
  action_title: string;
  action_instructions: string;
  preferred_coach_tip: string | null;
}

export interface BookingStrategy {
  headline: string;
  recommended_order: number[];
  strategy_reason: string;
  same_coach_probability: string; // HIGH, MODERATE, BEST_EFFORT
  steps: BookingOrderStep[];
  insider_tips: string[];
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
  booking_strategy?: BookingStrategy | null;
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
 * Extract numeric available seats from a SubLeg's raw status or position.
 */
export function extractNumericSeats(leg: SubLeg): number {
  if (typeof leg.position === 'number' && leg.position > 0) {
    return leg.position;
  }
  const match = (leg.raw_status || '').match(/\d+/);
  return match ? parseInt(match[0], 10) : 0;
}

/**
 * Format date string to DD-MMM-YYYY for user instructions.
 */
export function formatDatePretty(dateStr?: string): string {
  if (!dateStr) return 'Scheduled Date';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const day = String(d.getDate()).padStart(2, '0');
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  } catch {
    return dateStr;
  }
}

/**
 * Intelligent client-side booking strategy fallback calculator.
 * Ensures booking strategy is always available even if backend response or cached data omitted it.
 */
export function ensureBookingStrategy(
  solution: SmartRouteSolution,
  originDate?: string
): BookingStrategy {
  if (solution.booking_strategy) {
    return solution.booking_strategy;
  }

  const legs = solution.legs || [];
  if (legs.length === 0) {
    const fallbackStrategy: BookingStrategy = {
      headline: 'Direct confirmed booking',
      recommended_order: [1],
      strategy_reason: 'This route has a single leg. Book normally on IRCTC.',
      same_coach_probability: 'HIGH',
      steps: [],
      insider_tips: [
        'Book during standard IRCTC hours (00:20 to 23:45 IST) to prevent payment timeouts.',
        'Add passenger profiles into your IRCTC Master List to autofill details in seconds.',
      ],
    };
    solution.booking_strategy = fallbackStrategy;
    return fallbackStrategy;
  }

  let order: number[];
  let headline: string;
  let reason: string;
  let probability: string;
  const steps: BookingOrderStep[] = [];

  if (legs.length === 2) {
    const [firstLeg, secondLeg] = legs;
    const seats1 = extractNumericSeats(firstLeg);
    const seats2 = extractNumericSeats(secondLeg);

    let primaryLeg: SubLeg;
    let dependentLeg: SubLeg;

    if (seats2 > seats1) {
      order = [secondLeg.leg_number, firstLeg.leg_number];
      primaryLeg = secondLeg;
      dependentLeg = firstLeg;
      headline = `Book Leg ${secondLeg.leg_number} (${secondLeg.from_station} to ${secondLeg.to_station}) first for coach matching`;
      reason = `Leg ${secondLeg.leg_number} has more open seats (${seats2} available) than Leg ${firstLeg.leg_number} (${seats1} available). Securing your booking on Leg ${secondLeg.leg_number} first locks in your confirmed coach ID (e.g., S3 or B2). You can then enter that coach ID as your 'Preferred Coach' when booking Leg ${firstLeg.leg_number}.`;
      probability = seats2 >= 4 && seats1 >= 1 ? 'HIGH' : 'MODERATE';
    } else if (seats1 > seats2) {
      order = [firstLeg.leg_number, secondLeg.leg_number];
      primaryLeg = firstLeg;
      dependentLeg = secondLeg;
      headline = `Book Leg ${firstLeg.leg_number} (${firstLeg.from_station} to ${firstLeg.to_station}) first for coach matching`;
      reason = `Leg ${firstLeg.leg_number} has more open seats (${seats1} available) than Leg ${secondLeg.leg_number} (${seats2} available). Securing your booking on Leg ${firstLeg.leg_number} first locks in your confirmed coach ID. You can then enter that coach ID as your 'Preferred Coach' when booking Leg ${secondLeg.leg_number}.`;
      probability = seats1 >= 4 && seats2 >= 1 ? 'HIGH' : 'MODERATE';
    } else {
      order = [firstLeg.leg_number, secondLeg.leg_number];
      primaryLeg = firstLeg;
      dependentLeg = secondLeg;
      if (seats1 <= 1) {
        headline = `Book Leg ${firstLeg.leg_number} first, then select nearby coach preference for Leg ${secondLeg.leg_number}`;
        reason = `Both legs have scarce inventory (1 seat each). Book Leg ${firstLeg.leg_number} immediately to confirm, then enter its coach ID when booking Leg ${secondLeg.leg_number}. If that coach is full, IRCTC PRS will allocate the nearest available coach.`;
        probability = 'BEST_EFFORT';
      } else {
        headline = `Book Leg ${firstLeg.leg_number} first, then match coach in Leg ${secondLeg.leg_number}`;
        reason = `Both legs have balanced availability (${seats1} seats each). Book Leg ${firstLeg.leg_number} to receive your coach number, then set that coach as preferred when booking Leg ${secondLeg.leg_number}.`;
        probability = seats1 >= 5 ? 'HIGH' : 'MODERATE';
      }
    }

    const datePrimary = primaryLeg.journey_date || originDate || '';
    const dateDependent = dependentLeg.journey_date || originDate || '';

    steps.push({
      step_number: 1,
      leg_number: primaryLeg.leg_number,
      from_station: primaryLeg.from_station,
      to_station: primaryLeg.to_station,
      journey_date: datePrimary,
      departure_time: primaryLeg.departure_time,
      raw_status: primaryLeg.raw_status,
      available_seats: extractNumericSeats(primaryLeg),
      action_title: `Step 1: Book Leg ${primaryLeg.leg_number} (${primaryLeg.from_station} -> ${primaryLeg.to_station})`,
      action_instructions: `Book on IRCTC for journey date ${formatDatePretty(datePrimary)} (Dep: ${primaryLeg.departure_time || 'Scheduled'}). Complete payment and note assigned Coach ID (e.g. S4, B2, M1) from your confirmation screen.`,
      preferred_coach_tip: 'Do not set preferred coach for this first ticket. Let IRCTC assign the primary coach.',
    });

    steps.push({
      step_number: 2,
      leg_number: dependentLeg.leg_number,
      from_station: dependentLeg.from_station,
      to_station: dependentLeg.to_station,
      journey_date: dateDependent,
      departure_time: dependentLeg.departure_time,
      raw_status: dependentLeg.raw_status,
      available_seats: extractNumericSeats(dependentLeg),
      action_title: `Step 2: Book Leg ${dependentLeg.leg_number} (${dependentLeg.from_station} -> ${dependentLeg.to_station})`,
      action_instructions: `Immediately book on IRCTC for journey date ${formatDatePretty(dateDependent)} (Dep: ${dependentLeg.departure_time || 'Scheduled'}). On the Passenger Details page, expand 'Other Preferences' and enter the Coach ID from Step 1.`,
      preferred_coach_tip: 'Entering the Coach ID from Step 1 instructs IRCTC to seat you in the same coach. If the exact coach is full, IRCTC will allocate the closest adjacent coach.',
    });
  } else {
    // Multi-leg (> 2 legs)
    const sortedLegs = [...legs].sort((a, b) => {
      const seatsA = extractNumericSeats(a);
      const seatsB = extractNumericSeats(b);
      if (seatsB !== seatsA) return seatsB - seatsA;
      return (b.distance_km || 0) - (a.distance_km || 0);
    });

    order = sortedLegs.map((l) => l.leg_number);
    const first = sortedLegs[0];
    headline = `Book Leg ${first.leg_number} (${first.from_station} to ${first.to_station}) first as anchor coach`;
    reason = `Leg ${first.leg_number} has the highest seat buffer (${extractNumericSeats(first)} seats). Booking it first establishes your anchor coach ID for the remaining connecting legs.`;
    probability = 'MODERATE';

    sortedLegs.forEach((leg, idx) => {
      const ldate = leg.journey_date || originDate || '';
      if (idx === 0) {
        steps.push({
          step_number: 1,
          leg_number: leg.leg_number,
          from_station: leg.from_station,
          to_station: leg.to_station,
          journey_date: ldate,
          departure_time: leg.departure_time,
          raw_status: leg.raw_status,
          available_seats: extractNumericSeats(leg),
          action_title: `Step 1: Book Leg ${leg.leg_number} (Anchor Leg)`,
          action_instructions: `Book on IRCTC for journey date ${formatDatePretty(ldate)} (${leg.from_station} -> ${leg.to_station}). Note down the allotted Coach ID.`,
          preferred_coach_tip: 'Let IRCTC assign primary coach for this anchor ticket.',
        });
      } else {
        steps.push({
          step_number: idx + 1,
          leg_number: leg.leg_number,
          from_station: leg.from_station,
          to_station: leg.to_station,
          journey_date: ldate,
          departure_time: leg.departure_time,
          raw_status: leg.raw_status,
          available_seats: extractNumericSeats(leg),
          action_title: `Step ${idx + 1}: Book Leg ${leg.leg_number} with Coach Preference`,
          action_instructions: `Book on IRCTC for journey date ${formatDatePretty(ldate)} (${leg.from_station} -> ${leg.to_station}). Enter Coach ID from Step 1.`,
          preferred_coach_tip: 'Set Preferred Coach ID to match your anchor ticket.',
        });
      }
    });
  }

  const insiderTips = [
    'Book during standard IRCTC hours (00:20 to 23:45 IST) to prevent payment timeouts.',
    'Add all passenger profiles into your IRCTC Master List to autofill details in seconds.',
    "On IRCTC passenger details page, expand 'Other Preferences' and enter the coach number in 'Preferred Coach ID'.",
    'If exact coach is full, IRCTC automatically places you in the nearest adjacent coach.',
  ];

  const strategy: BookingStrategy = {
    headline,
    recommended_order: order,
    strategy_reason: reason,
    same_coach_probability: probability,
    steps,
    insider_tips: insiderTips,
  };

  solution.booking_strategy = strategy;
  return strategy;
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
    if (cached.data && cached.data.solutions) {
      for (const sol of cached.data.solutions) {
        if (!sol.booking_strategy) {
          sol.booking_strategy = ensureBookingStrategy(sol, cached.data.journey_date);
        }
      }
    }
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

  // 5. Ensure booking strategy is populated on all solutions
  if (data && data.solutions) {
    for (const sol of data.solutions) {
      if (!sol.booking_strategy) {
        sol.booking_strategy = ensureBookingStrategy(sol, data.journey_date);
      }
    }
  }

  // 6. Save to 5-minute cache
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
