const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadWatchService(mockFetch, mockDeviceId = 'tw_test_device_123') {
  const filePath = path.join(__dirname, '../src/services/watchService.ts');
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
    './authService': {
      authService: {
        getDeviceId: async () => mockDeviceId,
      },
    },
    './trainService': {
      getTransportApiBaseUrl: () => 'https://test-api.trainwatch.app',
    },
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    fetch: mockFetch,
    process: { env: {} },
    URL,
    JSON,
    Error,
  });

  return exports;
}

test('normalizeDateToIso formats dates to YYYY-MM-DD correctly', () => {
  const { normalizeDateToIso } = loadWatchService(async () => {});
  assert.equal(normalizeDateToIso('15-11-2026'), '2026-11-15');
  assert.equal(normalizeDateToIso('05/04/2026'), '2026-04-05');
  assert.equal(normalizeDateToIso('2026-11-15'), '2026-11-15');
});

test('createWatch posts correct body with device auth header', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 201,
      json: async () => ({
        watch_id: 'watch_abc',
        owner_id: 'tw_test_device_123',
        status: 'ACTIVE',
      }),
    };
  };

  const { watchService } = loadWatchService(mockFetch, 'tw_test_device_123');
  const result = await watchService.createWatch({
    trainNumber: '12661',
    source: 'ms',
    destination: 'ten',
    journeyDate: '15-11-2026',
    travelClass: '3a',
    quota: 'gn',
  });

  assert.equal(capturedUrl, 'https://test-api.trainwatch.app/api/v1/watches');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer tw_test_device_123');

  const parsedBody = JSON.parse(capturedOptions.body);
  assert.equal(parsedBody.train_number, '12661');
  assert.equal(parsedBody.source, 'MS');
  assert.equal(parsedBody.destination, 'TEN');
  assert.equal(parsedBody.journey_date, '2026-11-15');
  assert.equal(parsedBody.travel_class, '3A');
  assert.equal(parsedBody.quota, 'GN');
  assert.equal(parsedBody.condition.kind, 'becomes_available');
  assert.equal(result.watch_id, 'watch_abc');
});

test('createWatch handles validation errors from backend gracefully', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({
      error: {
        code: 'unprocessable_entity',
        message: 'source and destination must differ',
      },
    }),
  });

  const { watchService } = loadWatchService(mockFetch);
  await assert.rejects(
    () =>
      watchService.createWatch({
        trainNumber: '12661',
        source: 'MS',
        destination: 'MS',
        journeyDate: '2026-11-15',
        travelClass: '3A',
      }),
    /source and destination must differ/
  );
});

test('getWatch, updateWatchStatus, and deleteWatch perform expected HTTP calls', async () => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: options.method === 'DELETE' ? 204 : 200,
      json: async () => ({ watch_id: 'w1', status: 'PAUSED' }),
    };
  };

  const { watchService } = loadWatchService(mockFetch);

  await watchService.getWatch('w1');
  assert.equal(calls[0].url, 'https://test-api.trainwatch.app/api/v1/watches/w1');
  assert.equal(calls[0].options.method, 'GET');

  await watchService.updateWatchStatus('w1', 'PAUSED');
  assert.equal(calls[1].url, 'https://test-api.trainwatch.app/api/v1/watches/w1');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), { status: 'paused' });

  await watchService.deleteWatch('w1');
  assert.equal(calls[2].url, 'https://test-api.trainwatch.app/api/v1/watches/w1');
  assert.equal(calls[2].options.method, 'DELETE');
});

test('listWatches and updateWatchCondition perform expected HTTP calls', async () => {
  const calls = [];
  const mockFetch = async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ watches: [{ watch_id: 'w1', status: 'ACTIVE' }] }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        watch_id: 'w1',
        condition: { kind: 'seats_below', maximum_position: 25 },
      }),
    };
  };

  const { watchService } = loadWatchService(mockFetch);

  const watches = await watchService.listWatches();
  assert.equal(calls[0].url, 'https://test-api.trainwatch.app/api/v1/watches');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(watches.length, 1);
  assert.equal(watches[0].watch_id, 'w1');

  const updated = await watchService.updateWatchCondition('w1', {
    kind: 'seats_below',
    maximum_position: 25,
  });
  assert.equal(calls[1].url, 'https://test-api.trainwatch.app/api/v1/watches/w1');
  assert.equal(calls[1].options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    condition: { kind: 'seats_below', maximum_position: 25 },
  });
  assert.equal(updated.condition.kind, 'seats_below');
});
