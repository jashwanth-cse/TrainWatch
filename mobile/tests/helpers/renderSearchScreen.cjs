// Run real screen hooks/callbacks with native rendering and network seams stubbed.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

const sourceRoot = path.dirname(path.dirname(require.resolve('../../src/screens/HomeScreen.tsx')));

function renderSearchScreen(name, { storage = {}, params = {}, resultType = 'direct' } = {}) {
  const slots = [], effects = [], timers = new Map();
  let index = 0, nextTimer = 0, dirty = true, tree, pushed;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === 'function' ? initial() : initial;
      return [slots[slot], (value) => {
        const updated = typeof value === 'function' ? value(slots[slot]) : value;
        if (!Object.is(updated, slots[slot])) { slots[slot] = updated; dirty = true; }
      }];
    },
    useRef(initial) { const slot = index++; slots[slot] ??= { current: initial }; return slots[slot]; },
    useMemo(fn) { index++; return fn(); },
    useEffect(fn, dependencies) {
      const slot = index++, previous = slots[slot];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        effects.push(() => { previous?.cleanup?.(); slots[slot] = { dependencies, cleanup: fn() }; });
      }
    },
  };
  const animation = () => ({ start: (callback) => callback?.() });
  const modules = {
    react,
    'react-native': {
      View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity', FlatList: 'FlatList',
      StyleSheet: { create: (styles) => styles, absoluteFill: {} },
      Dimensions: { get: () => ({ height: 800, width: 400 }) },
      Animated: { Value: class { interpolate() { return 0; } }, View: 'Animated.View',
        timing: animation, spring: animation, sequence: animation },
      Alert: { alert() {} },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top: 20, bottom: 20 }) },
    'expo-router': {
      useRouter: () => ({ back() {}, push: (value) => { pushed = value; } }),
      useLocalSearchParams: () => ({ source: 'NDLS', destination: 'CNB', date: '01-11-2026', ...params }),
    },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'lucide-react-native': new Proxy({}, { get: (_, key) => String(key) }),
    '../services/trainService': { searchTrains: async () => ({
      result_type: resultType, route_type: resultType,
      trains: Array.from({ length: 20 }, (_, i) => ({ train_number: String(i), departure_time: '12:00' })),
    }) },
    '../services/stationService': {
      getLastSearch: async () => storage.last ?? null,
      saveLastSearch: async (value) => { storage.last = structuredClone(value); },
      addRecentStation: async () => {},
    },
    '../components/DatePickerModal': { DatePickerModal: 'DatePickerModal',
      formatDateToApi: () => '01-11-2026', formatDateForDisplay: () => '1 Nov' },
  };
  function loadFile(relative) {
    const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
    const { outputText } = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React, esModuleInterop: true,
    } });
    const exports = {};
    vm.runInNewContext(outputText, {
      exports, queueMicrotask,
      setTimeout: (fn) => { timers.set(++nextTimer, fn); return nextTimer; },
      clearTimeout: (id) => timers.delete(id),
      require(id) {
        if (id in modules) return modules[id];
        if (id === '../utils/quota') return loadFile('utils/quota.ts');
        if (id === '../theme/tokens') return loadFile('theme/tokens.ts');
        if (id.startsWith('../components/')) {
          const component = id.split('/').at(-1); return { [component]: component };
        }
        if (id === '../utils/availabilityHelper') return { parseAvailabilityStatus: () => ({}) };
        throw new Error(`Unexpected screen dependency: ${id}`);
      },
    });
    return exports;
  }
  const Screen = loadFile(`screens/${name}.tsx`)[name];
  function find(predicate, node) {
    if (arguments.length === 1) node = tree;
    if (Array.isArray(node)) {
      for (const child of node) { const found = find(predicate, child); if (found) return found; }
    } else if (node && typeof node === 'object') {
      if (node.type && predicate(node)) return node;
      return find(predicate, Object.values(node.props ?? {}));
    }
  }
  async function settle() {
    for (let i = 0; i < 8; i++) {
      if (dirty) {
        dirty = false; index = 0; tree = Screen(); effects.splice(0).forEach((fn) => fn());
      }
      await Promise.resolve();
    }
    if (dirty) throw new Error('Screen did not settle');
  }
  return {
    find, settle, timers, get pushed() { return pushed; },
    async advanceTimers() {
      const pending = [...timers.values()]; timers.clear(); pending.forEach((fn) => fn()); await settle();
    },
    unmount() { slots.forEach((slot) => slot?.cleanup?.()); },
  };
}
module.exports = { renderSearchScreen };
