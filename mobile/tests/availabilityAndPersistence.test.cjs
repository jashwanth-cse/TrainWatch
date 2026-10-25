const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadAvailabilityHelper() {
  const filePath = path.join(__dirname, '../src/utils/availabilityHelper.ts');
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
    '../theme/tokens': {
      colors: {
        surfaceSubtle: '#F8FAFC',
        textSecondary: '#64748B',
        textMuted: '#94A3B8',
        statusRegretBg: '#F1F5F9',
        statusRegret: '#64748B',
        statusAvailableBg: '#ECFDF5',
        statusAvailable: '#10B981',
        statusRacBg: '#FFFBEB',
        statusRac: '#F59E0B',
        statusWlBg: '#FEF2F2',
        statusWl: '#EF4444',
      },
    },
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

test('parseAvailabilityStatus correctly classifies Regret and Departed as Non Bookable and untrackable', () => {
  const { parseAvailabilityStatus } = loadAvailabilityHelper();

  const regret = parseAvailabilityStatus('REGRET');
  assert.equal(regret.badgeLabel, 'NON BOOKABLE');
  assert.equal(regret.modalLabel, 'NON BOOKABLE');
  assert.equal(regret.canTrack, false);
  assert.equal(regret.isBookable, false);

  const departed = parseAvailabilityStatus('TRAIN DEPARTED');
  assert.equal(departed.badgeLabel, 'NON BOOKABLE');
  assert.equal(departed.modalLabel, 'NON BOOKABLE');
  assert.equal(departed.canTrack, false);
});

test('parseAvailabilityStatus correctly prevents NOT AVAILABLE from false-matching AVAILABLE', () => {
  const { parseAvailabilityStatus } = loadAvailabilityHelper();

  const notAvail = parseAvailabilityStatus('NOT AVAILABLE');
  assert.equal(notAvail.badgeLabel, 'NOT AVAILABLE');
  assert.equal(notAvail.canTrack, false);
  assert.equal(notAvail.textColor, '#64748B'); // Gray, NOT Green!

  const unavail = parseAvailabilityStatus('UNAVAILABLE');
  assert.equal(unavail.badgeLabel, 'NOT AVAILABLE');
  assert.equal(unavail.canTrack, false);
});

test('parseAvailabilityStatus correctly classifies AVAILABLE, RAC, and WAITLIST', () => {
  const { parseAvailabilityStatus } = loadAvailabilityHelper();

  const avail = parseAvailabilityStatus('AVAILABLE 12');
  assert.equal(avail.badgeLabel, 'AVAILABLE');
  assert.equal(avail.canTrack, true);
  assert.equal(avail.textColor, '#10B981'); // Green

  const rac = parseAvailabilityStatus('RAC 4');
  assert.equal(rac.badgeLabel, 'RAC');
  assert.equal(rac.canTrack, true);
  assert.equal(rac.textColor, '#F59E0B'); // Amber

  const wl = parseAvailabilityStatus('GNWL 25');
  assert.equal(wl.badgeLabel, 'WAITLIST');
  assert.equal(wl.canTrack, true);
  assert.equal(wl.textColor, '#EF4444'); // Red
});
