const test = require('node:test');
const assert = require('node:assert/strict');
const { loadStationService } = require('./helpers/loadStationService.cjs');

const source = { code: 'NDLS', name: 'New Delhi', state: 'DELHI' };
const destination = { code: 'CNB', name: 'Kanpur', state: 'UTTAR PRADESH' };

function codes(stations) {
  return Array.from(stations, (station) => station.code);
}

test('concurrent route additions retain both stations in invocation order', async () => {
  const { addRecentStation, getRecentStations } = loadStationService();
  await Promise.all([addRecentStation(source), addRecentStation(destination)]);
  assert.deepEqual(codes(await getRecentStations()), ['CNB', 'NDLS']);
});

test('overlapping duplicate additions keep the later name and unrelated station', async () => {
  const { addRecentStation, getRecentStations } = loadStationService();
  await Promise.all([
    addRecentStation({ ...source, code: 'ndls', name: 'NEW DELHI' }),
    addRecentStation(destination),
    addRecentStation(source),
  ]);
  const recent = await getRecentStations();
  assert.deepEqual(codes(recent), ['NDLS', 'CNB']);
  assert.equal(recent[0].name, 'New Delhi');
});

test('concurrent additions preserve the eight-station cap and move duplicates to front', async () => {
  const { addRecentStation, getRecentStations } = loadStationService();
  await Promise.all(Array.from({ length: 12 }, (_, i) => addRecentStation({
    code: `S${i}`, name: `Station ${i}`, state: '',
  })));
  assert.deepEqual(codes(await getRecentStations()), ['S11', 'S10', 'S9', 'S8', 'S7', 'S6', 'S5', 'S4']);
  await addRecentStation({ code: 's7', name: 'Updated Station Seven', state: '' });
  const recent = await getRecentStations();
  assert.deepEqual(codes(recent), ['s7', 'S11', 'S10', 'S9', 'S8', 'S6', 'S5', 'S4']);
  assert.equal(recent[0].name, 'Updated Station Seven');
});

test('failed storage writes do not reject callers or poison later queued updates', async () => {
  let value = null;
  let writes = 0;
  const { addRecentStation, getRecentStations } = loadStationService({
    getItem: async () => value,
    setItem: async (_, next) => {
      if (++writes === 1) throw new Error('synthetic storage failure');
      value = next;
    },
  });
  await Promise.all([addRecentStation(source), addRecentStation(destination)]);
  assert.deepEqual(codes(await getRecentStations()), ['CNB']);
  await addRecentStation(source);
  assert.deepEqual(codes(await getRecentStations()), ['NDLS', 'CNB']);
});

test('a failed storage read and invalid input leave later updates usable', async () => {
  let value = null;
  let reads = 0;
  const { addRecentStation, getRecentStations } = loadStationService({
    getItem: async () => {
      if (++reads === 1) throw new Error('synthetic read failure');
      return value;
    },
    setItem: async (_, next) => { value = next; },
  });
  await Promise.all([
    addRecentStation({ code: '', name: '', state: '' }),
    addRecentStation(source),
    addRecentStation(destination),
  ]);
  assert.deepEqual(codes(await getRecentStations()), ['CNB', 'NDLS']);
});
