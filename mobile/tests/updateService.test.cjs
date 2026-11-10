const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadUpdateService(options = {}) {
  const filePath = path.join(__dirname, '../src/services/updateService.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const storageMap = options.storageMap || new Map();
  const mockStorage = {
    getItem: async (k) => (storageMap.has(k) ? storageMap.get(k) : null),
    setItem: async (k, v) => {
      storageMap.set(k, String(v));
    },
    removeItem: async (k) => {
      storageMap.delete(k);
    },
  };

  const platform = options.platform || 'android';
  const mockFetch = options.fetchFn || (async () => ({ ok: false, status: 500 }));

  const mockFileSystem = options.fileSystem || {
    cacheDirectory: 'file:///data/user/0/com.trainwatch.app/cache/',
    getInfoAsync: async () => ({ exists: false }),
    deleteAsync: async () => {},
    createDownloadResumable: (url, target, headers, onProgress) => ({
      downloadAsync: async () => {
        if (onProgress) {
          onProgress({ totalBytesExpectedToWrite: 2000, totalBytesWritten: 2000 });
        }
        return { uri: target };
      },
    }),
    getContentUriAsync: async (uri) => `content://com.trainwatch.app.provider/cache/${path.basename(uri)}`,
  };

  const mockIntentLauncher = options.intentLauncher || {
    startActivityAsync: async () => ({}),
  };

  const modules = {
    'react-native': {
      Platform: { OS: platform },
    },
    '@react-native-async-storage/async-storage': mockStorage,
    'expo-constants': {
      expoConfig: { version: options.currentVersion || '1.0.0' },
    },
    'expo-file-system': mockFileSystem,
    'expo-file-system/legacy': mockFileSystem,
    'expo-intent-launcher': mockIntentLauncher,
  };

  const exports = {};

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    fetch: mockFetch,
    process: { env: {} },
    JSON,
    Error,
    Math,
    parseInt,
    Number,
    Boolean,
    Array,
    String,
    Map,
  });

  return {
    exports,
    storageMap,
  };
}

test('compareSemver: correctly evaluates version relationships', () => {
  const { exports } = loadUpdateService();
  const { compareSemver } = exports;

  assert.strictEqual(compareSemver('v1.0.1', '1.0.0'), 1);
  assert.strictEqual(compareSemver('1.0.0', 'v1.0.1'), -1);
  assert.strictEqual(compareSemver('v1.0.0', '1.0.0'), 0);
  assert.strictEqual(compareSemver('1.2.0', '1.1.9'), 1);
  assert.strictEqual(compareSemver('2.0.0', '1.99.99'), 1);
  assert.strictEqual(compareSemver('v1.0.0-rc1', '1.0.0'), 0);
  assert.strictEqual(compareSemver('v1.0.1-beta.2', '1.0.0'), 1);
  assert.strictEqual(compareSemver('v1.0', '1.0.0'), 0);
});

test('checkForAppUpdate: detects newer version with valid APK asset', async () => {
  const mockRelease = {
    tag_name: 'v1.1.0',
    name: 'Version 1.1.0 Release',
    body: '- Added intra-train seat switching\n- Improved push notification reliability',
    published_at: '2026-11-10T10:00:00Z',
    assets: [
      {
        name: 'source-code.zip',
        browser_download_url: 'https://github.com/trainwatch/archive.zip',
      },
      {
        name: 'trainwatch-v1.1.0.apk',
        browser_download_url: 'https://github.com/trainwatch/releases/download/v1.1.0/trainwatch.apk',
        size: 28400000,
      },
    ],
  };

  const fetchFn = async (url) => {
    assert.match(url, /repos\/jashwanth-cse\/TrainWatch\/releases\/latest/);
    return {
      ok: true,
      status: 200,
      json: async () => mockRelease,
    };
  };

  const { exports } = loadUpdateService({ fetchFn, currentVersion: '1.0.0' });
  const result = await exports.checkForAppUpdate({ currentVersion: '1.0.0', fetchFn });

  assert.strictEqual(result.hasUpdate, true);
  assert.strictEqual(result.currentVersion, '1.0.0');
  assert.ok(result.release);
  assert.strictEqual(result.release.version, 'v1.1.0');
  assert.strictEqual(result.release.apkFileName, 'trainwatch-v1.1.0.apk');
  assert.strictEqual(
    result.release.apkDownloadUrl,
    'https://github.com/trainwatch/releases/download/v1.1.0/trainwatch.apk'
  );
  assert.strictEqual(result.release.apkSizeBytes, 28400000);
  assert.strictEqual(result.isDismissed, false);
});

test('checkForAppUpdate: returns hasUpdate=false when already on latest version', async () => {
  const mockRelease = {
    tag_name: 'v1.0.0',
    assets: [{ name: 'app.apk', browser_download_url: 'https://example.invalid/app.apk' }],
  };

  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => mockRelease,
  });

  const { exports } = loadUpdateService({ fetchFn, currentVersion: '1.0.0' });
  const result = await exports.checkForAppUpdate({ currentVersion: '1.0.0', fetchFn });

  assert.strictEqual(result.hasUpdate, false);
  assert.strictEqual(result.currentVersion, '1.0.0');
});

test('checkForAppUpdate: returns error when release contains no APK asset', async () => {
  const mockRelease = {
    tag_name: 'v1.2.0',
    assets: [{ name: 'bundle.js', browser_download_url: 'https://example.invalid/bundle.js' }],
  };

  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => mockRelease,
  });

  const { exports } = loadUpdateService({ fetchFn, currentVersion: '1.0.0' });
  const result = await exports.checkForAppUpdate({ currentVersion: '1.0.0', fetchFn });

  assert.strictEqual(result.hasUpdate, false);
  assert.strictEqual(result.error, 'No APK asset found in latest release');
});

test('checkForAppUpdate: handles GitHub API failure and network exceptions gracefully', async () => {
  const errorFetch = async () => ({
    ok: false,
    status: 403,
  });

  const { exports: exp1 } = loadUpdateService();
  const res1 = await exp1.checkForAppUpdate({ fetchFn: errorFetch });
  assert.strictEqual(res1.hasUpdate, false);
  assert.match(res1.error, /status 403/);

  const networkThrowFetch = async () => {
    throw new Error('Connection refused');
  };
  const { exports: exp2 } = loadUpdateService();
  const res2 = await exp2.checkForAppUpdate({ fetchFn: networkThrowFetch });
  assert.strictEqual(res2.hasUpdate, false);
  assert.strictEqual(res2.error, 'Connection refused');
});

test('checkForAppUpdate: identifies previously dismissed update versions', async () => {
  const storageMap = new Map([['trainwatch_dismissed_update_version', 'v1.1.0']]);
  const mockRelease = {
    tag_name: 'v1.1.0',
    assets: [{ name: 'app.apk', browser_download_url: 'https://example.invalid/app.apk' }],
  };

  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: async () => mockRelease,
  });

  const { exports } = loadUpdateService({ storageMap, fetchFn });
  const result = await exports.checkForAppUpdate({ currentVersion: '1.0.0', fetchFn });

  assert.strictEqual(result.hasUpdate, true);
  assert.strictEqual(result.isDismissed, true);

  // Clearing dismissal allows prompting again
  await exports.clearDismissedUpdate();
  const resultAfterClear = await exports.checkForAppUpdate({ currentVersion: '1.0.0', fetchFn });
  assert.strictEqual(resultAfterClear.isDismissed, false);
});

test('checkPostUpdateToast: tracks version transitions and records first-run', async () => {
  const storageMap = new Map();
  const { exports } = loadUpdateService({ storageMap });

  // First install / first run
  const firstRun = await exports.checkPostUpdateToast('1.0.0');
  assert.strictEqual(firstRun.isNewVersion, false);
  assert.strictEqual(storageMap.get('trainwatch_last_installed_version'), '1.0.0');

  // Next run on same version
  const sameVersionRun = await exports.checkPostUpdateToast('1.0.0');
  assert.strictEqual(sameVersionRun.isNewVersion, false);

  // App upgraded to 1.1.0
  const upgradedRun = await exports.checkPostUpdateToast('1.1.0');
  assert.strictEqual(upgradedRun.isNewVersion, true);
  assert.strictEqual(upgradedRun.previousVersion, '1.0.0');
  assert.strictEqual(upgradedRun.currentVersion, '1.1.0');
  assert.strictEqual(storageMap.get('trainwatch_last_installed_version'), '1.1.0');
});

test('downloadAndInstallApk: rejects non-Android platforms', async () => {
  const { exports } = loadUpdateService({ platform: 'ios' });
  const result = await exports.downloadAndInstallApk('https://example.invalid/app.apk', undefined, {
    platformOs: 'ios',
  });

  assert.strictEqual(result.success, false);
  assert.strictEqual(result.error, 'In-app APK installation is only supported on Android');
});

test('downloadAndInstallApk: streams download and triggers Android package intent', async () => {
  let progressCalled = false;
  let deletedExisting = false;
  let contentUriRequested = '';
  let launchedIntent = null;

  const mockFileSystem = {
    cacheDirectory: 'file:///cache/',
    getInfoAsync: async () => ({ exists: true }),
    deleteAsync: async () => {
      deletedExisting = true;
    },
    createDownloadResumable: (url, target, headers, onProgress) => ({
      downloadAsync: async () => {
        if (onProgress) {
          onProgress({ totalBytesExpectedToWrite: 5000000, totalBytesWritten: 5000000 });
        }
        return { uri: target };
      },
    }),
    getContentUriAsync: async (uri) => {
      contentUriRequested = uri;
      return 'content://com.trainwatch.app.provider/cache/trainwatch-update.apk';
    },
  };

  const mockIntentLauncher = {
    startActivityAsync: async (action, params) => {
      launchedIntent = { action, params };
      return {};
    },
  };

  const { exports } = loadUpdateService({
    platform: 'android',
    fileSystem: mockFileSystem,
    intentLauncher: mockIntentLauncher,
  });

  const onProgress = (prog, total, written) => {
    if (prog === 1) progressCalled = true;
  };

  const result = await exports.downloadAndInstallApk(
    'https://github.com/trainwatch/releases/download/v1.1.0/trainwatch.apk',
    onProgress,
    {
      fileSystem: mockFileSystem,
      intentLauncher: mockIntentLauncher,
      platformOs: 'android',
    }
  );

  assert.strictEqual(result.success, true);
  assert.strictEqual(deletedExisting, true);
  assert.strictEqual(progressCalled, true);
  assert.strictEqual(contentUriRequested, 'file:///cache/trainwatch-update.apk');
  assert.ok(launchedIntent);
  assert.strictEqual(launchedIntent.action, 'android.intent.action.VIEW');
  assert.strictEqual(
    launchedIntent.params.data,
    'content://com.trainwatch.app.provider/cache/trainwatch-update.apk'
  );
  assert.strictEqual(launchedIntent.params.type, 'application/vnd.android.package-archive');
  assert.strictEqual(launchedIntent.params.flags, 1);
});
