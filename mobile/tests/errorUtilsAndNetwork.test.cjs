const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadModule(relativePath, extraGlobals = {}) {
  const filePath = path.join(__dirname, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  const modules = {
    'react-native': {
      Platform: { OS: 'android' },
      AppState: { addEventListener: () => ({ remove: () => {} }) },
    },
    'expo-network': {
      getNetworkStateAsync: async () => ({ isConnected: true, isInternetReachable: true, type: 'WIFI' }),
    },
    'expo-intent-launcher': {
      ActivityAction: {
        WIRELESS_SETTINGS: 'android.settings.WIRELESS_SETTINGS',
        WIFI_SETTINGS: 'android.settings.WIFI_SETTINGS',
        SETTINGS: 'android.settings.SETTINGS',
      },
      startActivityAsync: async () => {},
    },
    '../utils/errorUtils': extraGlobals.errorUtils || {},
  };

  const sandbox = {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    fetch: globalThis.fetch,
    URL: globalThis.URL,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
    console,
    ...extraGlobals,
  };

  vm.runInNewContext(outputText, sandbox);
  return exports;
}

test('stripHostnames: cleanly strips dreamdestiny.cloud.run and backend URLs', () => {
  const errorUtils = loadModule('../src/utils/errorUtils.ts');

  const sample1 = 'Failed to fetch from https://dreamdestiny.cloud.run/api/v1/trains: connection refused';
  const cleaned1 = errorUtils.stripHostnames(sample1);
  assert.equal(cleaned1.includes('dreamdestiny.cloud.run'), false);
  assert.equal(cleaned1.includes('https://'), false);

  const sample2 = 'Unable to resolve host "dreamdestiny.cloud.run": No address associated with hostname';
  const cleaned2 = errorUtils.stripHostnames(sample2);
  assert.equal(cleaned2.includes('dreamdestiny.cloud.run'), false);

  const sample3 = 'Error connecting to 192.168.1.100:8005 failed';
  const cleaned3 = errorUtils.stripHostnames(sample3);
  assert.equal(cleaned3.includes('192.168.1.100'), false);
});

test('sanitizeError: identifies network offline failures and formats user message without leaking hostname', () => {
  const errorUtils = loadModule('../src/utils/errorUtils.ts');

  const rawErr = new Error('TypeError: Network request failed: https://dreamdestiny.cloud.run/api/v1/trains/search');
  const result = errorUtils.sanitizeError(rawErr);

  assert.equal(result.isNoInternet, true);
  assert.equal(result.isTimeout, false);
  assert.equal(result.isServerError, false);
  assert.equal(result.userMessage, 'No internet connection. Please check your mobile data or Wi-Fi.');
  assert.equal(result.userMessage.includes('dreamdestiny'), false);
});

test('sanitizeError: identifies timeout errors and masks infrastructure', () => {
  const errorUtils = loadModule('../src/utils/errorUtils.ts');

  const rawErr = new Error('Request timed out while connecting to https://trainwatch-api.run.app');
  const result = errorUtils.sanitizeError(rawErr);

  assert.equal(result.isTimeout, true);
  assert.equal(result.isNoInternet, false);
  assert.equal(result.userMessage.includes('Connection timed out'), true);
  assert.equal(result.userMessage.includes('run.app'), false);
});

test('sanitizeError: handles server 5xx errors cleanly', () => {
  const errorUtils = loadModule('../src/utils/errorUtils.ts');

  const rawErr = new Error('Server error (502): Bad Gateway');
  const result = errorUtils.sanitizeError(rawErr);

  assert.equal(result.isServerError, true);
  assert.equal(result.userMessage.includes('temporarily unavailable'), true);
});

test('pingInternetReachability: returns true when Google captive portal returns 204 or 200', async () => {
  const mockFetch = async () => ({
    status: 204,
  });

  const networkService = loadModule('../src/services/networkService.ts', {
    fetch: mockFetch,
  });

  const isReachable = await networkService.pingInternetReachability(500);
  assert.equal(isReachable, true);
});

test('pingInternetReachability: returns false when network fetch throws or times out', async () => {
  const mockFetch = async () => {
    throw new Error('Network error');
  };

  const networkService = loadModule('../src/services/networkService.ts', {
    fetch: mockFetch,
  });

  const isReachable = await networkService.pingInternetReachability(500);
  assert.equal(isReachable, false);
});

test('checkNetworkStatus: sets isInternetReachable to false when captive portal probe fails', async () => {
  const mockFetch = async () => {
    throw new Error('Connection refused');
  };

  const networkService = loadModule('../src/services/networkService.ts', {
    fetch: mockFetch,
  });

  const status = await networkService.checkNetworkStatus();
  assert.equal(status.isConnected, true);
  assert.equal(status.isInternetReachable, false);
});
