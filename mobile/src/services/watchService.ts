import { authService } from './authService';
import { getTransportApiBaseUrl } from './trainService';

export interface WatchCondition {
  kind: 'becomes_available' | 'improves' | 'reaches_threshold';
  target_status?: 'AVL' | 'RAC' | 'WL';
  maximum_position?: number;
}

export interface CreateWatchInput {
  trainNumber: string;
  source: string;
  destination: string;
  journeyDate: string; // Accepts DD-MM-YYYY or YYYY-MM-DD
  travelClass: string;
  quota?: string;
  condition?: WatchCondition;
}

export interface WatchRecord {
  watch_id: string;
  owner_id: string;
  query: {
    train_number: string;
    source: string;
    destination: string;
    journey_date: string;
    travel_class: string;
    quota: string;
    watch_key: string;
  };
  condition: {
    kind: string;
    target_status?: string | null;
    maximum_position?: number | null;
  };
  status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED';
  created_at: string;
  updated_at: string;
}

export function normalizeDateToIso(dateStr: string): string {
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

class WatchService {
  private async getAuthHeader(): Promise<Record<string, string>> {
    const deviceId = await authService.getDeviceId();
    return {
      Authorization: `Bearer ${deviceId}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async createWatch(input: CreateWatchInput): Promise<WatchRecord> {
    const baseUrl = getTransportApiBaseUrl();
    const headers = await this.getAuthHeader();
    const isoDate = normalizeDateToIso(input.journeyDate);

    const payload = {
      train_number: input.trainNumber.trim(),
      source: input.source.trim().toUpperCase(),
      destination: input.destination.trim().toUpperCase(),
      journey_date: isoDate,
      travel_class: input.travelClass.trim().toUpperCase(),
      quota: (input.quota || 'GN').trim().toUpperCase(),
      condition: input.condition || { kind: 'becomes_available' },
    };

    const response = await fetch(`${baseUrl}/api/v1/watches`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      let errorMessage = `Failed to create alert (${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson?.error?.message) {
          errorMessage = errorJson.error.message;
        } else if (errorJson?.detail) {
          errorMessage =
            typeof errorJson.detail === 'string'
              ? errorJson.detail
              : JSON.stringify(errorJson.detail);
        }
      } catch {
        // ignore fallback
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async getWatch(watchId: string): Promise<WatchRecord> {
    const baseUrl = getTransportApiBaseUrl();
    const headers = await this.getAuthHeader();

    const response = await fetch(`${baseUrl}/api/v1/watches/${watchId}`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Watch not found (${response.status})`);
    }

    return response.json();
  }

  async updateWatchStatus(
    watchId: string,
    status: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'EXPIRED'
  ): Promise<WatchRecord> {
    const baseUrl = getTransportApiBaseUrl();
    const headers = await this.getAuthHeader();

    const response = await fetch(`${baseUrl}/api/v1/watches/${watchId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ status }),
    });

    if (!response.ok) {
      let errorMessage = `Failed to update alert (${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson?.error?.message) errorMessage = errorJson.error.message;
      } catch {
        // ignore fallback
      }
      throw new Error(errorMessage);
    }

    return response.json();
  }

  async deleteWatch(watchId: string): Promise<void> {
    const baseUrl = getTransportApiBaseUrl();
    const headers = await this.getAuthHeader();

    const response = await fetch(`${baseUrl}/api/v1/watches/${watchId}`, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to delete alert (${response.status})`);
    }
  }
}

export const watchService = new WatchService();
