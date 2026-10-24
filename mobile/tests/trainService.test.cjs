const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadTrainService(mockFetch) {
  const filePath = path.join(__dirname, '../src/services/trainService.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    fetch: mockFetch,
    process: { env: { EXPO_PUBLIC_TRANSPORT_SERVICE_URL: 'https://test-transport.run.app' } },
    URL,
  });

  return exports;
}

test('searchTrains constructs valid request URL with query parameters', async () => {
  let calledUrl = '';
  let calledMethod = '';
  const mockFetch = async (url, options) => {
    calledUrl = url;
    calledMethod = options.method;
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          source: 'NDLS',
          destination: 'CNB',
          total_trains: 1,
          trains: [{ train_number: '12418', train_name: 'PRAYAGRAJ EXP', classes: [] }],
        },
      }),
    };
  };

  const { searchTrains } = loadTrainService(mockFetch);
  const result = await searchTrains({
    source: 'ndls',
    destination: 'cnb',
    date: '28-10-2026',
    quota: 'GN',
    travelClass: '3A',
  });

  assert.equal(calledMethod, 'GET');
  assert.ok(calledUrl.includes('from=NDLS'));
  assert.ok(calledUrl.includes('to=CNB'));
  assert.ok(calledUrl.includes('date=28-10-2026'));
  assert.ok(calledUrl.includes('travelClass=3A'));
  assert.ok(calledUrl.includes('quota=GN'));
  assert.equal(result.total_trains, 1);
  assert.equal(result.trains[0].train_number, '12418');
});

test('searchTrains omits travelClass filter when set to All Classes', async () => {
  let calledUrl = '';
  const mockFetch = async (url) => {
    calledUrl = url;
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: { source: 'CBE', destination: 'MAS', total_trains: 0, trains: [] },
      }),
    };
  };

  const { searchTrains } = loadTrainService(mockFetch);
  await searchTrains({
    source: 'CBE',
    destination: 'MAS',
    date: '30-10-2026',
    travelClass: 'All Classes',
  });

  assert.ok(!calledUrl.includes('travelClass='));
  assert.ok(calledUrl.includes('quota=GN'));
});

test('searchTrains handles upstream error responses properly', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 404,
    json: async () => ({ detail: 'No direct trains found between stations' }),
  });

  const { searchTrains } = loadTrainService(mockFetch);
  await assert.rejects(
    async () => {
      await searchTrains({ source: 'XXX', destination: 'YYY', date: '01-11-2026' });
    },
    { message: 'No direct trains found between stations' }
  );
});

test('fetchLiveAvailability issues POST request with expected arguments', async () => {
  let calledUrl = '';
  let calledMethod = '';
  const mockFetch = async (url, options) => {
    calledUrl = url;
    calledMethod = options.method;
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          train_number: '12626',
          availability: 'AVAILABLE 42',
          prediction: 94,
          fare: 1450,
        },
      }),
    };
  };

  const { fetchLiveAvailability } = loadTrainService(mockFetch);
  const result = await fetchLiveAvailability({
    trainNo: '12626',
    source: 'NDLS',
    destination: 'MAS',
    travelClass: '3A',
    date: '02-11-2026',
    quota: 'GN',
  });

  assert.equal(calledMethod, 'POST');
  assert.ok(calledUrl.includes('trainNo=12626'));
  assert.ok(calledUrl.includes('source=NDLS'));
  assert.ok(calledUrl.includes('destination=MAS'));
  assert.ok(calledUrl.includes('travelClass=3A'));
  assert.equal(result.data.availability, 'AVAILABLE 42');
});
