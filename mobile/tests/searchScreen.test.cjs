const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSearchScreen } = require('./helpers/renderSearchScreen.cjs');

async function commitRoute(screen) {
  const route = screen.find((node) => node.type === 'TouchableOpacity'
    && node.props.children?.some((child) => child?.type === 'Text' && child.props.children.includes('NDLS')));
  assert.ok(route);
  route.props.onPress(); await screen.settle();
  screen.find((node) => node.props.accessibilityLabel === 'Swap departure and destination stations').props.onPress();
  await screen.settle();
  const commit = screen.find((node) => node.type === 'TouchableOpacity'
    && node.props.children?.some((child) => child?.props?.children?.some((text) =>
      text?.props?.children?.includes('Update Route & Search'))));
  assert.ok(commit);
  commit.props.onPress(); await screen.settle();
}
async function changeSearch(screen, action) {
  if (action === 'route') return commitRoute(screen);
  if (action === 'refresh') {
    screen.find((node) => node.props.accessibilityLabel === 'Refresh train results').props.onPress();
  } else {
    screen.find((node) => node.type === 'DatePickerModal').props.onSelect({
      apiFormat: '02-11-2026', displayFormat: '2 Nov',
    });
  }
  await screen.settle();
}

for (const action of ['refresh', 'date', 'route']) {
  test(`pagination recovers when ${action} interrupts its delayed action`, async () => {
    const screen = renderSearchScreen('TrainResultsScreen'); await screen.settle();
    const list = () => screen.find((node) => node.type === 'FlatList');
    const initialSize = list().props.data.length;
    list().props.onEndReached(); await screen.settle();
    assert.equal(screen.timers.size, 1);
    await changeSearch(screen, action);
    assert.equal(screen.timers.size, 0);
    assert.equal(list().props.ListFooterComponent, undefined);
    list().props.onEndReached(); await screen.advanceTimers();
    assert.ok(list().props.data.length > initialSize); screen.unmount();
  });
  test(`nearby reveal cannot update a new search after ${action}`, async () => {
    const screen = renderSearchScreen('TrainResultsScreen', { resultType: 'nearby' });
    await screen.settle();
    const reveal = () => screen.find((node) => node.type === 'ResponsiveButton'
      && node.props.title === 'Show trains from Nearby Stations');
    reveal().props.onPress(); await screen.settle();
    assert.equal(screen.timers.size, 1);
    await changeSearch(screen, action);
    assert.equal(screen.timers.size, 0); await screen.advanceTimers();
    assert.equal(screen.find((node) => node.type === 'FlatList'), undefined);
    assert.ok(reveal()); reveal().props.onPress(); await screen.advanceTimers();
    assert.ok(screen.find((node) => node.type === 'FlatList')); screen.unmount();
  });
}
for (const kind of ['direct', 'nearby']) {
  test(`unmount cancels the ${kind} pending action`, async () => {
    const screen = renderSearchScreen('TrainResultsScreen', { resultType: kind });
    await screen.settle();
    if (kind === 'direct') screen.find((node) => node.type === 'FlatList').props.onEndReached();
    else screen.find((node) => node.type === 'ResponsiveButton').props.onPress();
    assert.equal(screen.timers.size, 1); screen.unmount(); assert.equal(screen.timers.size, 0);
  });
}
test('route switch preserves Tatkal code and label on next launch', async () => {
  const storage = {};
  const results = renderSearchScreen('TrainResultsScreen', { storage, params: { quota: 'TQ' } });
  await results.settle(); await commitRoute(results);
  assert.equal(storage.last.quotaCode, 'TQ'); assert.equal(storage.last.quota, 'Tatkal');
  assert.equal(storage.last.source.code, 'CNB');
  const home = renderSearchScreen('HomeScreen', { storage }); await home.settle();
  assert.equal(home.find((node) => node.type === 'QuotaPickerModal').props.selectedQuota, 'TQ');
  assert.ok(home.find((node) => node.type === 'Text' && node.props.children.includes('Tatkal')));
  home.find((node) => node.props.accessibilityLabel === 'Search trains').props.onPress();
  assert.equal(home.pushed.params.quota, 'TQ'); assert.equal(storage.last.quotaCode, 'TQ');
  results.unmount(); home.unmount();
});
for (const last of [{ quota: 'TQ' }, { quota: 'Tatkal' }, { quota: 'TQ', quotaCode: 'TQ' }]) {
  test(`restore legacy quota data ${JSON.stringify(last)}`, async () => {
    const home = renderSearchScreen('HomeScreen', { storage: { last } }); await home.settle();
    assert.equal(home.find((node) => node.type === 'QuotaPickerModal').props.selectedQuota, 'TQ');
    assert.ok(home.find((node) => node.type === 'Text' && node.props.children.includes('Tatkal')));
    home.find((node) => node.props.accessibilityLabel === 'Search trains').props.onPress();
    assert.equal(home.pushed.params.quota, 'TQ'); home.unmount();
  });
}
