const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStationService } = require('./helpers/loadStationService.cjs');

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

test('repeated station searches return results for every query', () => {
  const queries = ['NDLS', 'MUMBAI', 'CHENNAI', 'BANGALORE', 'HOWRAH', 'PUNE', 'KODAI', 'SALEM', 'JAIPUR', 'DELHI'];
  for (let i = 0; i < 100; i++) {
    const q = queries[i % queries.length];
    const res = searchStations(q);
    assert.ok(res.length > 0);
  }
});
