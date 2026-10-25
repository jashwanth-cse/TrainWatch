const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadAvailabilityDetailModal() {
  const filePath = path.join(__dirname, '../src/components/AvailabilityDetailModal.tsx');
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      jsx: ts.JsxEmit.React,
    },
  });

  const exports = {};
  const modules = {
    react: {
      useState: (init) => [init, () => {}],
      useEffect: () => {},
      useCallback: (fn) => fn,
    },
    'react-native': {
      View: 'View',
      Text: 'Text',
      Modal: 'Modal',
      StyleSheet: { create: (s) => s },
      TouchableOpacity: 'TouchableOpacity',
      ActivityIndicator: 'ActivityIndicator',
      TextInput: 'TextInput',
      ScrollView: 'ScrollView',
    },
    'react-native-safe-area-context': {
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    },
    'expo-router': {
      useRouter: () => ({ push: () => {}, back: () => {} }),
    },
    '../theme/tokens': {
      colors: {},
      radius: {},
      spacing: {},
    },
    '../services/trainService': {
      fetchLiveAvailability: async () => ({ success: true, data: {} }),
    },
    '../services/watchService': {
      watchService: {},
    },
    '../services/notificationService': {
      requestNotificationPermissionsAndRegisterDevice: async () => ({ granted: true, token: 'mock_token' }),
    },
    'lucide-react-native': {
      TrainFront: 'TrainFront',
      ArrowRight: 'ArrowRight',
      Bell: 'Bell',
      RefreshCw: 'RefreshCw',
      CalendarDays: 'CalendarDays',
      CheckCircle2: 'CheckCircle2',
      X: 'X',
      AlertCircle: 'AlertCircle',
      TrendingUp: 'TrendingUp',
      Check: 'Check',
    },
    '../utils/availabilityHelper': {
      parseAvailabilityStatus: () => ({
        badgeLabel: 'AVAILABLE',
        bgColor: '#fff',
        textColor: '#000',
        dotColor: '#0f0',
        canTrack: true,
      }),
    },
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    process: { env: {} },
    Error,
    parseInt,
    isNaN,
    Math,
    String,
    Boolean,
    Number,
  });

  return exports;
}

test('extractAvailableSeats correctly parses seat counts from various IRCTC formats', () => {
  const { extractAvailableSeats } = loadAvailabilityDetailModal();

  assert.equal(extractAvailableSeats('AVAILABLE 250'), 250);
  assert.equal(extractAvailableSeats('AVAILABLE-0250'), 250);
  assert.equal(extractAvailableSeats('CURR_AVBL 12'), 12);
  assert.equal(extractAvailableSeats('AVL 45'), 45);
  assert.equal(extractAvailableSeats('AVAILABLE 5'), 5);
  assert.equal(extractAvailableSeats('NOT AVAILABLE'), null);
  assert.equal(extractAvailableSeats(''), null);
  assert.equal(extractAvailableSeats(null), null);
});
