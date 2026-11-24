const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const { renderSearchScreen } = require('./helpers/renderSearchScreen.cjs');

function loadSmartRouteService(mockFetch, mockStorage = new Map()) {
  const errorUtilsPath = path.join(__dirname, '../src/utils/errorUtils.ts');
  const errorUtilsSource = fs.readFileSync(errorUtilsPath, 'utf8');
  const errorUtilsTranspiled = ts.transpileModule(errorUtilsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });
  const errorUtilsExports = {};
  vm.runInNewContext(errorUtilsTranspiled.outputText, {
    exports: errorUtilsExports,
    require,
    Error: globalThis.Error,
  });

  const filePath = path.join(__dirname, '../src/services/smartRouteService.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  const asyncStorageMock = {
    getItem: async (key) => mockStorage.get(key) || null,
    setItem: async (key, val) => {
      mockStorage.set(key, val);
    },
    getAllKeys: async () => Array.from(mockStorage.keys()),
    multiRemove: async (keys) => {
      for (const k of keys) mockStorage.delete(k);
    },
  };

  const modules = {
    '@react-native-async-storage/async-storage': asyncStorageMock,
    './trainService': {
      getTransportApiBaseUrl: () => 'https://test-api.trainwatch.app',
    },
    '../utils/errorUtils': errorUtilsExports,
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    fetch: mockFetch,
    process: { env: { EXPO_PUBLIC_TRAINWATCH_API_URL: 'https://test-api.trainwatch.app' } },
    Date: globalThis.Date,
    Math: globalThis.Math,
    JSON: globalThis.JSON,
    Error: globalThis.Error,
  });

  return { exports, mockStorage };
}

test('buildSmartRouteCacheKey formats unique key from train and route attributes', () => {
  const { exports } = loadSmartRouteService(async () => {});
  const key = exports.buildSmartRouteCacheKey({
    trainNo: '12662',
    origin: 'rjpm',
    destination: 'ms',
    journeyDate: '2026-11-20',
    travelClass: 'sl',
    quota: 'gn',
  });
  assert.equal(key, '12662_RJPM_MS_2026-11-20_SL_GN');
});

test('fetchSmartRoutes executes POST request to backend and caches response for 5 minutes', async () => {
  let fetchCallCount = 0;
  let requestUrl = '';
  let requestBody = null;

  const mockResponseData = {
    train_no: '12662',
    train_name: 'Pothigai Express',
    origin: 'RJPM',
    destination: 'MS',
    journey_date: '2026-11-20',
    travel_class: 'SL',
    journey_duration_hours: 10.5,
    journey_distance_km: 630,
    max_leg_horizon: 2,
    direct_status: 'WL 17',
    direct_fare: 360,
    solutions: [
      {
        solution_id: 'sol_1',
        tier: 'TIER_1_SAME_TRAIN_SPLIT',
        legs: [
          {
            leg_number: 1,
            train_no: '12662',
            train_name: 'Pothigai Express',
            from_station: 'RJPM',
            to_station: 'MDU',
            travel_class: 'SL',
            quota: 'GN',
            status: 'AVAILABLE',
            raw_status: 'AVAILABLE 24',
            position: 24,
            fare: 140,
            departure_time: '20:00',
            arrival_time: '21:30',
            duration_minutes: 90,
            distance_km: 75,
          },
          {
            leg_number: 2,
            train_no: '12662',
            train_name: 'Pothigai Express',
            from_station: 'MDU',
            to_station: 'MS',
            travel_class: 'SL',
            quota: 'GN',
            status: 'AVAILABLE',
            raw_status: 'AVAILABLE 18',
            position: 18,
            fare: 255,
            departure_time: '21:40',
            arrival_time: '06:50',
            duration_minutes: 550,
            distance_km: 555,
          },
        ],
        total_fare: 395,
        fare_surcharge: 35,
        fare_surcharge_pct: 9.7,
        total_duration_minutes: 640,
        boarding_station: null,
        is_confirmed: true,
        is_rac: false,
        recommendation_score: 85.15,
        split_stations: ['MDU'],
      },
    ],
    execution_time_ms: 250,
    stations_evaluated_count: 8,
    queries_executed_count: 9,
  };

  const mockFetch = async (url, options) => {
    fetchCallCount++;
    requestUrl = url;
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        message: 'Smart routes discovered successfully',
        data: mockResponseData,
      }),
    };
  };

  const { exports } = loadSmartRouteService(mockFetch);

  // First fetch: Network request
  const res1 = await exports.fetchSmartRoutes({
    trainNo: '12662',
    origin: 'RJPM',
    destination: 'MS',
    journeyDate: '2026-11-20',
    travelClass: 'SL',
  });

  assert.equal(fetchCallCount, 1);
  assert.equal(requestUrl, 'https://test-api.trainwatch.app/api/v1/trains/smart-routes');
  assert.equal(requestBody.train_no, '12662');
  assert.equal(requestBody.origin, 'RJPM');
  assert.equal(requestBody.destination, 'MS');
  assert.equal(res1.isFromCache, false);
  assert.equal(res1.data.train_no, '12662');
  assert.equal(res1.data.solutions.length, 1);
  assert.equal(res1.data.solutions[0].is_confirmed, true);

  // Second fetch: Served directly from cache, zero network calls
  const res2 = await exports.fetchSmartRoutes({
    trainNo: '12662',
    origin: 'RJPM',
    destination: 'MS',
    journeyDate: '2026-11-20',
    travelClass: 'SL',
  });

  assert.equal(fetchCallCount, 1, 'Cache hit must not execute another network request');
  assert.equal(res2.isFromCache, true);
  assert.ok(res2.remainingSeconds > 0 && res2.remainingSeconds <= 300);

  // Third fetch with forceRefresh: Within 5m window, rate limits the refresh to protect server
  const res3 = await exports.fetchSmartRoutes({
    trainNo: '12662',
    origin: 'RJPM',
    destination: 'MS',
    journeyDate: '2026-11-20',
    travelClass: 'SL',
    forceRefresh: true,
  });

  assert.equal(fetchCallCount, 1, 'Force refresh within 5m cooldown must be rate limited');
  assert.equal(res3.rateLimited, true);
  assert.equal(res3.isFromCache, true);
});

test('fetchSmartRoutes coalesces concurrent requests for the exact same parameters', async () => {
  let fetchCallCount = 0;
  const mockFetch = async () => {
    fetchCallCount++;
    // Simulate network delay
    await new Promise((r) => setTimeout(r, 20));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: { train_no: '12622', solutions: [] },
      }),
    };
  };

  const { exports } = loadSmartRouteService(mockFetch);

  // Trigger 3 concurrent requests simultaneously
  const [p1, p2, p3] = await Promise.all([
    exports.fetchSmartRoutes({
      trainNo: '12622',
      origin: 'GWL',
      destination: 'MAS',
      journeyDate: '2026-12-01',
      travelClass: '3A',
    }),
    exports.fetchSmartRoutes({
      trainNo: '12622',
      origin: 'GWL',
      destination: 'MAS',
      journeyDate: '2026-12-01',
      travelClass: '3A',
    }),
    exports.fetchSmartRoutes({
      trainNo: '12622',
      origin: 'GWL',
      destination: 'MAS',
      journeyDate: '2026-12-01',
      travelClass: '3A',
    }),
  ]);

  assert.equal(fetchCallCount, 1, 'In-flight coalescing must collapse duplicate concurrent fetches into 1');
  assert.equal(p1.data.train_no, '12622');
  assert.equal(p2.data.train_no, '12622');
  assert.equal(p3.data.train_no, '12622');
});

test('HomeScreen dual-mode navigation toggles between Track Seat and Multi leg', async () => {
  const home = renderSearchScreen('HomeScreen');
  await home.settle();

  // Initial tab: Track Seat
  assert.ok(home.find((node) => node.type === 'Text' && String(node.props.children).includes('Track your seats')));
  assert.ok(home.find((node) => node.type === 'Text' && String(node.props.children).includes('on-the-go')));

  // Switch to Multi leg tab
  const multiLegTab = home.find((node) => node.props?.accessibilityLabel === 'Multi leg tab');
  assert.ok(multiLegTab, 'Multi leg tab button must exist');
  multiLegTab.props.onPress();
  await home.settle();

  // Multi leg tagline & badge verification
  assert.ok(home.find((node) => node.type === 'Text' && String(node.props.children).includes('Get a confirm ticket')));
  assert.ok(home.find((node) => node.type === 'Text' && String(node.props.children).includes('on shift')));

  // Class picker allows expanded classes in multi-leg mode
  const classModal = home.find((node) => node.type === 'ClassPickerModal');
  assert.ok(classModal);
  assert.deepEqual(
    JSON.stringify(classModal.props.allowedClasses),
    JSON.stringify(['All Classes', 'SL', '3A', '2A', '1A', '3E', 'CC', '2S'])
  );

  // Quota is locked to General and unselectable, without Fixed badge
  assert.ok(home.find((node) => node.props?.accessibilityLabel === 'General quota locked'));
  assert.ok(
    !home.find((node) => node.type === 'Text' && String(node.props.children).includes('Fixed')),
    'Fixed label must not be rendered near General quota in multi-leg mode'
  );

  // Search Trains sends mode: multileg and quota: GN
  home.find((node) => node.props.accessibilityLabel === 'Search trains').props.onPress();
  assert.equal(home.pushed.params.mode, 'multileg');
  assert.equal(home.pushed.params.quota, 'GN');

  home.unmount();
});

function loadModalComponent() {
  const modalPath = path.join(__dirname, '../src/components/AvailabilityDetailModal.tsx');
  const source = fs.readFileSync(modalPath, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  });

  const helperPath = path.join(__dirname, '../src/utils/availabilityHelper.ts');
  const helperSource = fs.readFileSync(helperPath, 'utf8');
  const { outputText: helperTranspiled } = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const helperExports = {};
  vm.runInNewContext(helperTranspiled, {
    exports: helperExports,
    require: (mod) => {
      if (mod === '../theme/tokens') return { colors: {} };
      return require(mod);
    },
  });

  let pushed = null;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useRef: (init) => ({ current: init }),
  };

  const modules = {
    react,
    'react-native': {
      View: 'View',
      Text: 'Text',
      Modal: 'Modal',
      TouchableOpacity: 'TouchableOpacity',
      ActivityIndicator: 'ActivityIndicator',
      TextInput: 'TextInput',
      ScrollView: 'ScrollView',
      StyleSheet: { create: (s) => s },
    },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 10, top: 10 }) },
    'expo-router': { useRouter: () => ({ push: (p) => { pushed = p; } }) },
    '../theme/tokens': { colors: {}, radius: {}, spacing: {} },
    '../services/trainService': { fetchLiveAvailability: async () => ({}) },
    '../services/watchService': { watchService: {} },
    '../services/notificationService': { requestNotificationPermissionsAndRegisterDevice: async () => {} },
    'lucide-react-native': new Proxy({}, { get: (_, k) => String(k) }),
    '../utils/availabilityHelper': helperExports,
    '../utils/errorUtils': { sanitizeError: (e) => ({ userMessage: String(e) }) },
    '../services/networkService': { openNetworkSettings: async () => {} },
    '../services/stationService': {
      getStationName: (code) => String(code || ''),
      formatStationName: (s) => String(s || ''),
    },
  };

  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    parseInt,
    isNaN,
  });

  return { exports, getPushed: () => pushed };
}

function findNode(predicate, node) {
  if (!node) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const res = findNode(predicate, item);
      if (res) return res;
    }
    return null;
  }
  if (typeof node === 'object') {
    if (predicate(node)) return node;
    return findNode(predicate, Object.values(node.props || {}));
  }
  return null;
}

const defaultTestTrain = {
  train_number: '12662',
  train_name: 'Pothigai Express',
  from: { code: 'RJPM', name: 'Rajapalayam' },
  to: { code: 'MS', name: 'Chennai Egmore' },
  departure_time: '20:00',
  arrival_time: '06:50',
  duration: '10:50',
};

test('AvailabilityDetailModal renders Smart Split option with caption and handles callback', async () => {
  const { exports } = loadModalComponent();
  let smartSplitTriggered = false;
  const mockClass = {
    travel_class: 'SL',
    fare: 360,
    availability: 'WL 17',
    prediction: 0,
    bookable: true,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    onClose: () => {},
    onOpenSmartSplit: () => {
      smartSplitTriggered = true;
    },
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.ok(smartSplitBtn, 'Smart split button must exist with expected caption accessibility label');

  smartSplitBtn.props.onPress();
  assert.equal(smartSplitTriggered, true, 'onOpenSmartSplit callback must fire when pressed');
});

test('AvailabilityDetailModal does NOT render Smart Split option when seats are AVAILABLE', async () => {
  const { exports } = loadModalComponent();
  const mockClass = {
    travel_class: 'SL',
    fare: 360,
    availability: 'AVAILABLE 45',
    prediction: 0,
    bookable: true,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    onClose: () => {},
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.equal(smartSplitBtn, null, 'Smart Split must NOT be rendered when seats are AVAILABLE');
});

test('AvailabilityDetailModal renders Smart Split option for 1AC (1A) when waitlisted', async () => {
  const { exports } = loadModalComponent();
  const mockClass = {
    travel_class: '1A',
    fare: 2200,
    availability: 'WL 5',
    prediction: 0,
    bookable: true,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    onClose: () => {},
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.ok(smartSplitBtn, 'Smart Split must be rendered for 1A class when waitlisted');
});

test('AvailabilityDetailModal does NOT render Smart Split option for REGRET or NOT AVAILABLE', async () => {
  const { exports } = loadModalComponent();
  const mockClass = {
    travel_class: 'SL',
    fare: 360,
    availability: 'REGRET/WL 200',
    prediction: 0,
    bookable: false,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    onClose: () => {},
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.equal(smartSplitBtn, null, 'Smart Split must NOT be rendered for REGRET status');
});

test('AvailabilityDetailModal DOES render Smart Split for all expanded classes (SL, 3A, 2A, 1A, 3E, CC, 2S) when RAC or WAITLIST', async () => {
  const { exports } = loadModalComponent();
  const allSupportedClasses = ['SL', '3A', '2A', '1A', '3E', 'CC', '2S'];

  for (const cls of allSupportedClasses) {
    // 1. Waitlist condition -> Must show Smart Split
    const treeWl = exports.AvailabilityDetailModal({
      visible: true,
      train: defaultTestTrain,
      selectedClass: {
        travel_class: cls,
        fare: 650,
        availability: 'WL 12',
        prediction: 0,
        bookable: true,
        availability_source: 'live',
      },
      journeyDate: '2026-11-20',
      displayDate: '20 Nov',
      quota: 'GN',
      onClose: () => {},
    });

    const smartSplitBtnWl = findNode(
      (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
      treeWl
    );
    assert.ok(smartSplitBtnWl, `Smart Split must be rendered for ${cls} when WL`);

    // 2. Available condition -> Must NOT show Smart Split
    const treeAvl = exports.AvailabilityDetailModal({
      visible: true,
      train: defaultTestTrain,
      selectedClass: {
        travel_class: cls,
        fare: 650,
        availability: 'AVAILABLE 30',
        prediction: 0,
        bookable: true,
        availability_source: 'live',
      },
      journeyDate: '2026-11-20',
      displayDate: '20 Nov',
      quota: 'GN',
      onClose: () => {},
    });

    const smartSplitBtnAvl = findNode(
      (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
      treeAvl
    );
    assert.equal(smartSplitBtnAvl, null, `Smart Split must NOT be rendered for ${cls} when AVAILABLE`);
  }
});

test('AvailabilityDetailModal in multileg mode strictly hides seat alert form', async () => {
  const { exports } = loadModalComponent();
  const mockClass = {
    travel_class: '3A',
    fare: 950,
    availability: 'WL 14',
    prediction: 0,
    bookable: true,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    searchMode: 'multileg',
    onClose: () => {},
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.ok(smartSplitBtn, 'Smart Split must be visible in multileg mode when waitlisted');

  // Verify that "Track This Seat" or alert options are NOT rendered
  const trackSeatBtn = findNode(
    (n) => n.props?.children && (
      (Array.isArray(n.props.children) && n.props.children.includes('Track This Seat')) ||
      n.props.children === 'Track This Seat'
    ),
    tree
  );
  assert.equal(trackSeatBtn, null, 'Track This Seat button must NOT exist in multileg mode');
});

test('AvailabilityDetailModal in multileg mode shows direct seats notice when status is AVAILABLE', async () => {
  const { exports } = loadModalComponent();
  const mockClass = {
    travel_class: '3A',
    fare: 950,
    availability: 'AVAILABLE 12',
    prediction: 0,
    bookable: true,
    availability_source: 'live',
  };

  const tree = exports.AvailabilityDetailModal({
    visible: true,
    train: defaultTestTrain,
    selectedClass: mockClass,
    journeyDate: '2026-11-20',
    displayDate: '20 Nov',
    quota: 'GN',
    searchMode: 'multileg',
    onClose: () => {},
  });

  const smartSplitBtn = findNode(
    (n) => n.props?.accessibilityLabel === 'Smart Split: get a seat by changing seat mid journey',
    tree
  );
  assert.equal(smartSplitBtn, null, 'Smart Split must NOT be rendered when seats are AVAILABLE in multileg mode');

  const directSeatsNotice = findNode(
    (n) =>
      (Array.isArray(n.props?.children) && n.props.children.includes('Direct Seats Available')) ||
      n.props?.children === 'Direct Seats Available',
    tree
  );
  assert.ok(directSeatsNotice, 'Direct Seats Available notice must be rendered in multileg mode when AVL');
});
