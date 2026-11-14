import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

export const GITHUB_REPO_OWNER = 'jashwanth-cse';
export const GITHUB_REPO_NAME = 'TrainWatch';
export const LAST_INSTALLED_VERSION_KEY = 'trainwatch_last_installed_version';
export const DISMISSED_UPDATE_KEY = 'trainwatch_dismissed_update_version';
export const UPDATE_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24-hour reminder cooldown

export interface DismissedUpdateRecord {
  version: string;
  dismissedAt: number;
}

export interface AppReleaseInfo {
  version: string;
  name: string;
  releaseNotes: string;
  publishedAt: string;
  apkDownloadUrl: string;
  apkFileName: string;
  apkSizeBytes?: number;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  release?: AppReleaseInfo;
  isDismissed?: boolean;
  error?: string;
}

export interface PostUpdateResult {
  isNewVersion: boolean;
  previousVersion?: string;
  currentVersion: string;
}

export type DownloadProgressCallback = (
  progress: number,
  totalBytes: number,
  bytesWritten: number
) => void;

/**
 * Compare two semantic version strings (e.g. "v1.0.1" and "1.0.0").
 * Returns 1 if v1 > v2, -1 if v1 < v2, and 0 if equal.
 */
export function compareSemver(v1: string, v2: string): number {
  const clean = (v: string): string => v.trim().replace(/^[vV]/, '').split(/[-+]/)[0];
  const parts1 = clean(v1)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const parts2 = clean(v2)
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
  const maxLen = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLen; i++) {
    const p1 = parts1[i] ?? 0;
    const p2 = parts2[i] ?? 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Check GitHub Releases for a newer version of TrainWatch.
 */
export async function checkForAppUpdate(options?: {
  owner?: string;
  repo?: string;
  currentVersion?: string;
  fetchFn?: typeof fetch;
  storage?: typeof AsyncStorage;
}): Promise<UpdateCheckResult> {
  const owner = options?.owner || GITHUB_REPO_OWNER;
  const repo = options?.repo || GITHUB_REPO_NAME;
  const currentVersion =
    options?.currentVersion || Constants.expoConfig?.version || '1.0.0';
  const fetcher = options?.fetchFn || fetch;
  const storage = options?.storage || AsyncStorage;

  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
    const response = await fetcher(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'TrainWatch-App',
      },
    });

    if (!response.ok) {
      return {
        hasUpdate: false,
        currentVersion,
        error: `GitHub API responded with status ${response.status}`,
      };
    }

    const data = await response.json();
    const tagName: string = data.tag_name || '';
    if (!tagName) {
      return {
        hasUpdate: false,
        currentVersion,
        error: 'Release tag missing from GitHub response',
      };
    }

    const assets = Array.isArray(data.assets) ? data.assets : [];
    const apkAsset = assets.find(
      (asset: { name?: string; browser_download_url?: string }) =>
        typeof asset.name === 'string' &&
        asset.name.toLowerCase().endsWith('.apk') &&
        Boolean(asset.browser_download_url)
    );

    if (!apkAsset) {
      return {
        hasUpdate: false,
        currentVersion,
        error: 'No APK asset found in latest release',
      };
    }

    const hasNewerVersion = compareSemver(tagName, currentVersion) > 0;
    if (!hasNewerVersion) {
      return {
        hasUpdate: false,
        currentVersion,
      };
    }

    const isDismissed = await isUpdateDismissed(tagName, storage);

    const release: AppReleaseInfo = {
      version: tagName,
      name: data.name || tagName,
      releaseNotes: data.body || '',
      publishedAt: data.published_at || '',
      apkDownloadUrl: apkAsset.browser_download_url,
      apkFileName: apkAsset.name,
      apkSizeBytes: typeof apkAsset.size === 'number' ? apkAsset.size : undefined,
    };

    return {
      hasUpdate: true,
      currentVersion,
      release,
      isDismissed,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      hasUpdate: false,
      currentVersion,
      error: message,
    };
  }
}

/**
 * Check whether an update is dismissed and within the cooldown period.
 */
export async function isUpdateDismissed(
  targetVersion: string,
  storage: typeof AsyncStorage = AsyncStorage,
  now: number = Date.now()
): Promise<boolean> {
  try {
    const raw = await storage.getItem(DISMISSED_UPDATE_KEY);
    if (!raw) return false;

    // Handle JSON format with cooldown timestamp
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && parsed.version) {
        if (parsed.version !== targetVersion) {
          return false;
        }
        const dismissedAt = typeof parsed.dismissedAt === 'number' ? parsed.dismissedAt : 0;
        return (now - dismissedAt) < UPDATE_COOLDOWN_MS;
      }
    } catch {
      // Legacy fallback: raw version string
      if (raw === targetVersion) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Record that the user chose to dismiss / postpone an update with a 24hr cooldown.
 */
export async function dismissUpdate(
  version: string,
  storage: typeof AsyncStorage = AsyncStorage,
  now: number = Date.now()
): Promise<void> {
  try {
    const record: DismissedUpdateRecord = {
      version,
      dismissedAt: now,
    };
    await storage.setItem(DISMISSED_UPDATE_KEY, JSON.stringify(record));
  } catch {
    // Silent fallback
  }
}

/**
 * Clear the dismissed update record to allow prompting again.
 */
export async function clearDismissedUpdate(
  storage: typeof AsyncStorage = AsyncStorage
): Promise<void> {
  try {
    await storage.removeItem(DISMISSED_UPDATE_KEY);
  } catch {
    // Silent fallback
  }
}

/**
 * Detect whether the app has just been updated to a new version.
 */
export async function checkPostUpdateToast(
  currentVersion: string = Constants.expoConfig?.version || '1.0.0',
  storage: typeof AsyncStorage = AsyncStorage
): Promise<PostUpdateResult> {
  try {
    const lastVersion = await storage.getItem(LAST_INSTALLED_VERSION_KEY);
    if (!lastVersion) {
      await storage.setItem(LAST_INSTALLED_VERSION_KEY, currentVersion);
      return { isNewVersion: false, currentVersion };
    }

    if (compareSemver(currentVersion, lastVersion) > 0) {
      await storage.setItem(LAST_INSTALLED_VERSION_KEY, currentVersion);
      return {
        isNewVersion: true,
        previousVersion: lastVersion,
        currentVersion,
      };
    }

    return { isNewVersion: false, currentVersion };
  } catch {
    return { isNewVersion: false, currentVersion };
  }
}

/**
 * Download the APK into the application cache directory with progress tracking
 * and invoke the Android Package Installer.
 */
export async function downloadAndInstallApk(
  apkUrl: string,
  onProgress?: DownloadProgressCallback,
  injectedModules?: {
    fileSystem?: typeof FileSystem;
    intentLauncher?: typeof IntentLauncher;
    platformOs?: string;
  }
): Promise<{ success: boolean; error?: string }> {
  const fs = injectedModules?.fileSystem || FileSystem;
  const launcher = injectedModules?.intentLauncher || IntentLauncher;
  const os = injectedModules?.platformOs || Platform.OS;

  if (os !== 'android') {
    return {
      success: false,
      error: 'In-app APK installation is only supported on Android',
    };
  }

  try {
    const filename = 'trainwatch-update.apk';
    const targetPath = `${fs.cacheDirectory}${filename}`;

    const info = await fs.getInfoAsync(targetPath);
    if (info.exists) {
      await fs.deleteAsync(targetPath, { idempotent: true });
    }

    const downloadResumable = fs.createDownloadResumable(
      apkUrl,
      targetPath,
      {},
      (downloadProgress) => {
        const total = downloadProgress.totalBytesExpectedToWrite;
        const written = downloadProgress.totalBytesWritten;
        const progress = total > 0 ? written / total : 0;
        if (onProgress) {
          onProgress(progress, total, written);
        }
      }
    );

    const result = await downloadResumable.downloadAsync();
    if (!result || !result.uri) {
      return { success: false, error: 'APK download failed or was interrupted' };
    }

    const contentUri = await fs.getContentUriAsync(result.uri);

    await launcher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      type: 'application/vnd.android.package-archive',
    });

    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
