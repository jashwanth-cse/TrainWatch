const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { loadStationService } = require('../tests/helpers/loadStationService.cjs');

const { searchStations } = loadStationService();
const queries = ['NDLS', 'MUMBAI', 'CHENNAI', 'BANGALORE', 'HOWRAH', 'PUNE', 'KODAI', 'SALEM', 'JAIPUR', 'DELHI'];
const start = performance.now();
for (let i = 0; i < 100; i++) {
  const results = searchStations(queries[i % queries.length]);
  assert.ok(results.length > 0);
}
const duration = performance.now() - start;
console.log(`100 station searches: ${duration.toFixed(2)} ms`);
assert.ok(duration < 500, `Expected duration < 500ms, took ${duration}ms`);
