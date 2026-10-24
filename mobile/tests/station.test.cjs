const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadStationService() {
  const filePath = path.join(__dirname, '../src/services/stationService.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const stationsData = require('../src/data/stations.json');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  const modules = {
    '../data/stations.json': stationsData,
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
  });

  return exports;
}

const { searchStations, getStationByCode, POPULAR_STATIONS } = loadStationService();

test('empty query returns popular stations default list', () => {
  const results = searchStations('');
  assert.equal(results.length, POPULAR_STATIONS.length);
  assert.equal(results[0].code, 'NDLS');
});

test('exact station code search returns the station at index 0', () => {
  const results = searchStations('NDLS');
  assert.ok(results.length > 0);
  assert.equal(results[0].code, 'NDLS');
  assert.equal(results[0].name, 'NEW DELHI');
});

test('case-insensitive code search works correctly', () => {
  const results = searchStations('cnb');
  assert.ok(results.length > 0);
  assert.equal(results[0].code, 'CNB');
});

test('subsequence / city name search finds target station', () => {
  const results = searchStations('Coimbatore');
  assert.ok(results.length > 0);
  const cbe = results.find((s) => s.code === 'CBE');
  assert.ok(cbe);
  assert.equal(cbe.code, 'CBE');
});

test('Kinattukkadavu CNV code search resolves correctly', () => {
  const station = getStationByCode('CNV');
  assert.ok(station);
  assert.equal(station.code, 'CNV');
  assert.equal(station.name, 'Kinattukkadavu');

  const searchResults = searchStations('Kinattukkadavu');
  assert.ok(searchResults.length > 0);
  assert.equal(searchResults[0].code, 'CNV');
});

test('getStationByCode returns undefined for non-existent codes', () => {
  const invalid = getStationByCode('ZZZZ99');
  assert.equal(invalid, undefined);
});

test('performance benchmark: 100 searches execute in under 500ms', () => {
  const queries = ['NDLS', 'MUMBAI', 'CHENNAI', 'BANGALORE', 'HOWRAH', 'PUNE', 'KODAI', 'SALEM', 'JAIPUR', 'DELHI'];
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    const q = queries[i % queries.length];
    const res = searchStations(q);
    assert.ok(res.length > 0);
  }
  const duration = Date.now() - start;
  assert.ok(duration < 500, `Expected duration < 500ms, took ${duration}ms`);
});
