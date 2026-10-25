import AsyncStorage from '@react-native-async-storage/async-storage';
import stationsData from '../data/stations.json';

export interface Station {
  code: string;
  name: string;
  state: string;
}

interface CompactStation {
  c: string;
  n: string;
  s: string;
}

interface StationInternal extends Station {
  upperCode: string;
  upperName: string;
  words: string[];
}

const rawStations = stationsData as CompactStation[];

// Pre-normalize and pre-calculate uppercase fields once at startup
const allStations: StationInternal[] = rawStations.map((item) => {
  const upperCode = item.c.toUpperCase();
  const upperName = item.n.toUpperCase();
  return {
    code: item.c,
    name: item.n,
    state: item.s,
    upperCode,
    upperName,
    words: upperName.split(' '),
  };
});

// Fast O(1) lookup map by station code
const stationCodeMap = new Map<string, Station>();
for (let i = 0; i < allStations.length; i++) {
  const s = allStations[i];
  stationCodeMap.set(s.upperCode, {
    code: s.code,
    name: s.name,
    state: s.state,
  });
}

/**
 * Frequently searched major Indian railway hubs
 */
export const POPULAR_STATIONS: Station[] = [
  { code: 'NDLS', name: 'NEW DELHI', state: 'DELHI' },
  { code: 'CSMT', name: 'C SHIVAJI MAH T', state: 'MAHARASHTRA' },
  { code: 'MAS', name: 'MGR CHENNAI CENTRAL', state: 'TAMIL NADU' },
  { code: 'SBC', name: 'KSR BENGALURU', state: 'KARNATAKA' },
  { code: 'HWH', name: 'HOWRAH JN.', state: 'WEST BENGAL' },
  { code: 'CBE', name: 'COIMBATORE JN', state: 'TAMIL NADU' },
  { code: 'CNB', name: 'KANPUR CENTRAL JN.', state: 'UTTAR PRADESH' },
  { code: 'PUNE', name: 'PUNE JN.', state: 'MAHARASHTRA' },
  { code: 'ADI', name: 'AHMEDABAD JN.', state: 'GUJARAT' },
  { code: 'HYB', name: 'HYDERABAD DECCAN', state: 'TELANGANA' },
  { code: 'CNV', name: 'Kinattukkadavu', state: 'TAMIL NADU' },
];

/**
 * Look up a station by exact station code (case-insensitive)
 */
export function getStationByCode(code: string): Station | undefined {
  if (!code) return undefined;
  return stationCodeMap.get(code.trim().toUpperCase());
}

/**
 * High-performance station search:
 * Ranks exact code matches > code prefixes > name prefixes > word prefixes > contains
 */
export function searchStations(query: string, limit = 25): Station[] {
  const q = query.trim().toUpperCase();
  if (!q) {
    return POPULAR_STATIONS;
  }

  const exactCodeMatches: Station[] = [];
  const codePrefixMatches: Station[] = [];
  const namePrefixMatches: Station[] = [];
  const wordPrefixMatches: Station[] = [];
  const containsMatches: Station[] = [];

  for (let i = 0; i < allStations.length; i++) {
    const s = allStations[i];

    if (s.upperCode === q) {
      exactCodeMatches.push(s);
      continue;
    }

    if (s.upperCode.startsWith(q)) {
      codePrefixMatches.push(s);
      continue;
    }

    if (s.upperName.startsWith(q)) {
      namePrefixMatches.push(s);
      continue;
    }

    // If we already have enough high-confidence matches, skip deeper checks
    if (exactCodeMatches.length + codePrefixMatches.length + namePrefixMatches.length >= limit * 2) {
      continue;
    }

    // Check pre-split words
    let wordMatched = false;
    for (let w = 0; w < s.words.length; w++) {
      if (s.words[w].startsWith(q)) {
        wordPrefixMatches.push(s);
        wordMatched = true;
        break;
      }
    }
    if (wordMatched) continue;

    if (s.upperName.includes(q) || s.state.toUpperCase().includes(q)) {
      containsMatches.push(s);
    }
  }

  const combined = [
    ...exactCodeMatches,
    ...codePrefixMatches,
    ...namePrefixMatches,
    ...wordPrefixMatches,
    ...containsMatches,
  ];

  return combined.slice(0, limit);
}

const RECENT_STATIONS_STORAGE_KEY = '@trainwatch_recent_stations';
const LAST_SEARCH_STORAGE_KEY = '@trainwatch_last_search';

export interface LastSearchData {
  source: Station;
  destination: Station;
  travelClass?: string;
  quota?: string;
  quotaCode?: string;
}

/**
 * Retrieve user's recently searched/selected railway stations.
 */
export async function getRecentStations(): Promise<Station[]> {
  try {
    const raw = await AsyncStorage.getItem(RECENT_STATIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is Station => Boolean(item?.code && item?.name));
    }
  } catch {
    // Fail safe to empty list
  }
  return [];
}

let recentWriteQueue: Promise<void> = Promise.resolve();

/**
 * Prepend a station to the user's recent stations list (deduplicated, keeping top 8).
 */
export async function addRecentStation(station: Station): Promise<void> {
  if (!station?.code) return;
  recentWriteQueue = recentWriteQueue.then(async () => {
    try {
      const current = await getRecentStations();
      const filtered = current.filter(
        (s) => s.code.toUpperCase() !== station.code.toUpperCase()
      );
      const updated = [station, ...filtered].slice(0, 8);
      await AsyncStorage.setItem(RECENT_STATIONS_STORAGE_KEY, JSON.stringify(updated));
    } catch {
      // Keep later queued updates usable after storage failures.
    }
  });
  return recentWriteQueue;
}

/**
 * Retrieve the user's last searched stations and parameters.
 */
export async function getLastSearch(): Promise<LastSearchData | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.source?.code && parsed?.destination?.code) {
      return parsed as LastSearchData;
    }
  } catch {
    // Fail safe to null
  }
  return null;
}

/**
 * Persist the user's last searched stations and route parameters.
 */
export async function saveLastSearch(data: LastSearchData): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_SEARCH_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Silently continue
  }
}
