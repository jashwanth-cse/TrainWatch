export interface StationSimple {
  code: string;
  name: string;
}

export interface TravelClassInfo {
  travel_class: string;
  fare: number;
  availability: string;
  prediction: number;
  bookable: boolean;
  availability_source: 'cached' | 'live' | 'unavailable';
}

export interface TrainItem {
  train_number: string;
  train_name: string;
  train_type: string;
  from: StationSimple;
  to: StationSimple;
  departure_time: string;
  arrival_time: string;
  duration: string;
  distance: number;
  running_days: string[];
  has_pantry: boolean;
  lowest_fare: number;
  classes: TravelClassInfo[];
}

export interface TrainSearchResults {
  source: string;
  destination: string;
  total_trains: number;
  trains: TrainItem[];
  route_type: string;
  result_type?: string;
  fallback_reason?: string;
  latency_ms?: number;
}

import { sanitizeError } from '../utils/errorUtils';

export interface SearchTrainsParams {
  source: string;
  destination: string;
  date: string; // DD-MM-YYYY format
  quota?: string; // GN, TQ, LD, etc.
  travelClass?: string; // All, SL, 3A, etc.
}

export interface LiveAvailabilityParams {
  trainNo: string;
  source: string;
  destination: string;
  travelClass: string;
  date: string; // DD-MM-YYYY format
  quota?: string;
}

export interface LiveAvailabilityResult {
  success: boolean;
  message: string;
  data: {
    train_number: string;
    source: string;
    destination: string;
    travel_class: string;
    date: string;
    quota: string;
    availability: string;
    prediction?: number;
    fare?: number;
    bookable?: boolean;
    updated_at?: string;
  };
}

export function getTransportApiBaseUrl(): string {
  const envUrl =
    process.env.EXPO_PUBLIC_TRAINWATCH_API_URL ||
    process.env.EXPO_PUBLIC_TRANSPORT_SERVICE_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, '');
  }
  return '';
}

/**
 * Searches for trains between source and destination stations on a specific date.
 */
export async function searchTrains(params: SearchTrainsParams): Promise<TrainSearchResults> {
  const baseUrl = getTransportApiBaseUrl();
  if (!baseUrl) {
    throw new Error('API service endpoint is not configured. Please check environment configuration.');
  }
  const url = new URL(`${baseUrl}/api/v1/trains/search`);

  url.searchParams.set('from', params.source.trim().toUpperCase());
  url.searchParams.set('to', params.destination.trim().toUpperCase());
  url.searchParams.set('date', params.date.trim());

  if (params.quota && params.quota !== 'ALL') {
    url.searchParams.set('quota', params.quota);
  } else {
    url.searchParams.set('quota', 'GN');
  }

  if (params.travelClass && params.travelClass !== 'ALL' && params.travelClass !== 'All Classes') {
    url.searchParams.set('travelClass', params.travelClass);
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (netErr) {
    const sanitized = sanitizeError(netErr);
    throw new Error(sanitized.userMessage);
  }

  if (!response.ok) {
    let errorMsg = `Server error (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.detail) errorMsg = errJson.detail;
      else if (errJson?.message) errorMsg = errJson.message;
    } catch {
      // Fallback to HTTP error
    }
    const sanitized = sanitizeError(new Error(errorMsg));
    throw new Error(sanitized.userMessage);
  }

  const json = await response.json();
  if (!json.success || !json.data) {
    throw new Error(json.message || 'No trains found for selected route.');
  }

  const resultType = (json.data.result_type || json.data.route_type || 'direct').toLowerCase();

  return {
    source: json.data.source,
    destination: json.data.destination,
    total_trains: json.data.total_trains,
    trains: json.data.trains || [],
    route_type: resultType,
    result_type: resultType,
    fallback_reason: json.data.fallback_reason,
    latency_ms: json.data.latency_ms,
  };
}

/**
 * Direct Live Availability check for a specific train and class
 */
export async function fetchLiveAvailability(
  params: LiveAvailabilityParams
): Promise<LiveAvailabilityResult> {
  const baseUrl = getTransportApiBaseUrl();
  if (!baseUrl) {
    throw new Error('API service endpoint is not configured. Please check environment configuration.');
  }
  const url = new URL(`${baseUrl}/api/v1/trains/availability`);

  url.searchParams.set('trainNo', params.trainNo.trim());
  url.searchParams.set('source', params.source.trim().toUpperCase());
  url.searchParams.set('destination', params.destination.trim().toUpperCase());
  url.searchParams.set('travelClass', params.travelClass.trim().toUpperCase());
  url.searchParams.set('date', params.date.trim());
  url.searchParams.set('quota', params.quota || 'GN');

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (netErr) {
    const sanitized = sanitizeError(netErr);
    throw new Error(sanitized.userMessage);
  }

  if (!response.ok) {
    let errorMsg = `Availability error (${response.status})`;
    try {
      const errJson = await response.json();
      if (errJson?.detail) errorMsg = errJson.detail;
    } catch {
      // Fallback
    }
    const sanitized = sanitizeError(new Error(errorMsg));
    throw new Error(sanitized.userMessage);
  }

  return await response.json();
}
