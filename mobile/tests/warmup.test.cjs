const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadWarmupService(storageMap = new Map(), fetchMock = null) {
  const filePath = path.join(__dirname, '../src/services/backendWarmupService.ts');
  const source = readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const storage = {
    async getItem(key) {
      return storageMap.has(key) ? storageMap.get(key) : null;
    },
    async setItem(key, value) {
      storageMap.set(key, String(value));
    },
    async removeItem(key) {
      storageMap.delete(key);
    },
  };

  const appStateListeners = [];
  const appStateMock = {
    currentState: 'active',
    addEventListener(event, handler) {
      if (event === 'change') {
        appStateListeners.push(handler);
      }
      return {
        remove() {
          const idx = appStateListeners.indexOf(handler);
          if (idx !== -1) appStateListeners.splice(idx, 1);
        },
      };
    },
  };

  const trainServiceMock = {
    getTransportApiBaseUrl: () => 'https://dreamdestiny.cloud.run',
  };

  const defaultFetch = async (url) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'healthy' }),
    };
  };

  const activeFetch = fetchMock || defaultFetch;

  const exports = {};
  const context = {
    exports,
    fetch: activeFetch,
    AbortController: globalThis.AbortController,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    Date: globalThis.Date,
    console: globalThis.console,
    require(name) {
      if (name === '@react-native-async-storage/async-storage') {
        return storage;
      }
      if (name === 'react-native') {
        return { AppState: appStateMock };
      }
      if (name.includes('trainService')) {
        return trainServiceMock;
      }
      return require(name);
    },
  };

  vm.runInNewContext(outputText, context);

  return {
    service: exports,
    storageMap,
    appStateListeners,
  };
}

test('warmup: executes ping on fresh launch and saves timestamp to storage', async () => {
  let pingCount = 0;
  let targetUrl = '';
  const fetchMock = async (url) => {
    pingCount++;
    targetUrl = url;
    return { ok: true, status: 200, json: async () => ({}) };
  };

  const storageMap = new Map();
  const { service } = loadWarmupService(storageMap, fetchMock);

  const res = await service.triggerBackendWarmup();

  assert.equal(res.triggered, true);
  assert.equal(res.success, true);
  assert.equal(pingCount, 1);
  assert.equal(targetUrl, 'https://dreamdestiny.cloud.run/health');
  assert.ok(storageMap.has('@trainwatch_last_backend_ping'));
});

test('warmup: skips ping if cooldown window of 10 minutes is active', async () => {
  let pingCount = 0;
  const fetchMock = async () => {
    pingCount++;
    return { ok: true, status: 200 };
  };

  const now = Date.now();
  // 5 minutes ago (within 10m window)
  const storageMap = new Map([['@trainwatch_last_backend_ping', String(now - 5 * 60 * 1000)]]);
  const { service } = loadWarmupService(storageMap, fetchMock);

  const res = await service.triggerBackendWarmup();

  assert.equal(res.triggered, false);
  assert.equal(res.reason, 'cooldown_active');
  assert.equal(pingCount, 0, 'No HTTP request should be sent during cooldown');
});

test('warmup: triggers ping if cooldown window has expired (> 10 minutes)', async () => {
  let pingCount = 0;
  const fetchMock = async () => {
    pingCount++;
    return { ok: true, status: 200 };
  };

  const now = Date.now();
  // 11 minutes ago (expired)
  const storageMap = new Map([['@trainwatch_last_backend_ping', String(now - 11 * 60 * 1000)]]);
  const { service } = loadWarmupService(storageMap, fetchMock);

  const res = await service.triggerBackendWarmup();

  assert.equal(res.triggered, true);
  assert.equal(res.success, true);
  assert.equal(pingCount, 1);
});

test('warmup: in-flight coalescing ensures concurrent callers do not duplicate network calls', async () => {
  let activePings = 0;
  let totalCalls = 0;
  const fetchMock = async () => {
    totalCalls++;
    activePings++;
    await new Promise((resolve) => setTimeout(resolve, 30));
    activePings--;
    return { ok: true, status: 200 };
  };

  const storageMap = new Map();
  const { service } = loadWarmupService(storageMap, fetchMock);

  // Trigger 3 simultaneous warmups
  const [res1, res2, res3] = await Promise.all([
    service.triggerBackendWarmup({ force: true }),
    service.triggerBackendWarmup({ force: true }),
    service.triggerBackendWarmup({ force: true }),
  ]);

  assert.equal(totalCalls, 1, 'Only one HTTP request should be executed');
  assert.equal(res1.success, true);
  assert.equal(res2.success, true);
  assert.equal(res3.success, true);
});

test('warmup: handles network failures silently without throwing or crashing', async () => {
  const fetchMock = async () => {
    throw new Error('Network request failed (offline)');
  };

  const storageMap = new Map();
  const { service } = loadWarmupService(storageMap, fetchMock);

  const res = await service.triggerBackendWarmup({ force: true });

  assert.equal(res.triggered, true);
  assert.equal(res.success, false);
  assert.equal(res.reason, 'failed');
  assert.equal(storageMap.has('@trainwatch_last_backend_ping'), false);
});
