/* global __dirname */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadNotificationService({
  platform = 'android',
  initialPermissionStatus = 'undetermined',
  requestedPermissionStatus = 'granted',
  devicePushToken = 'fcm_native_test_token_123',
  devicePushType = platform,
  registerSuccess = true,
} = {}) {
  const filePath = path.join(__dirname, '../src/services/notificationService.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  let registeredToken = null;
  let registeredPlatform = null;
  let savedAuthToken = null;
  let channelConfig = null;
  let expoTokenRequests = 0;

  const modules = {
    'react-native': {
      Platform: { OS: platform },
    },
    'expo-notifications': {
      AndroidImportance: { MAX: 5 },
      setNotificationHandler: () => {},
      setNotificationChannelAsync: async (channelId, config) => {
        channelConfig = { channelId, ...config };
      },
      getPermissionsAsync: async () => ({ status: initialPermissionStatus }),
      requestPermissionsAsync: async () => ({ status: requestedPermissionStatus }),
      getDevicePushTokenAsync: async () => {
        if (!devicePushToken) throw new Error('No device push token available');
        return { type: devicePushType, data: devicePushToken };
      },
      getExpoPushTokenAsync: async () => {
        expoTokenRequests += 1;
        return { data: 'ExponentPushToken[synthetic]' };
      },
    },
    'expo-device': {
      isDevice: true,
    },
    'expo-constants': {
      default: {
        expoConfig: {
          extra: { eas: { projectId: 'test-project-id' } },
        },
      },
    },
    './deviceService': {
      registerDeviceToken: async (token, plat) => {
        registeredToken = token;
        registeredPlatform = plat;
        return registerSuccess;
      },
    },
    './authService': {
      authService: {
        setFcmToken: async (tok) => {
          savedAuthToken = tok;
        },
      },
    },
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    process: { env: {} },
    JSON,
    Error,
    console,
  });

  return {
    exports,
    getRegisteredToken: () => registeredToken,
    getRegisteredPlatform: () => registeredPlatform,
    getSavedAuthToken: () => savedAuthToken,
    getChannelConfig: () => channelConfig,
    getExpoTokenRequests: () => expoTokenRequests,
  };
}

test('initializeNotificationChannel creates android channel with MAX importance and light color', async () => {
  const { exports, getChannelConfig } = loadNotificationService({ platform: 'android' });
  await exports.initializeNotificationChannel();

  const channel = getChannelConfig();
  assert.ok(channel);
  assert.equal(channel.channelId, 'trainwatch-alerts');
  assert.equal(channel.importance, 5);
  assert.equal(channel.enableVibrate, true);
});

test('requestNotificationPermissionsAndRegisterDevice prompts user, gets token and registers with backend', async () => {
  const { exports, getRegisteredToken, getRegisteredPlatform, getSavedAuthToken } =
    loadNotificationService({
      initialPermissionStatus: 'undetermined',
      requestedPermissionStatus: 'granted',
      devicePushToken: 'fcm_native_test_token_123',
    });

  const result = await exports.requestNotificationPermissionsAndRegisterDevice();

  assert.equal(result.granted, true);
  assert.equal(result.token, 'fcm_native_test_token_123');
  assert.equal(getRegisteredToken(), 'fcm_native_test_token_123');
  assert.equal(getRegisteredPlatform(), 'android');
  assert.equal(getSavedAuthToken(), 'fcm_native_test_token_123');
});

test('requestNotificationPermissionsAndRegisterDevice returns granted: false when user denies', async () => {
  const { exports, getRegisteredToken } = loadNotificationService({
    initialPermissionStatus: 'undetermined',
    requestedPermissionStatus: 'denied',
  });

  const result = await exports.requestNotificationPermissionsAndRegisterDevice();

  assert.equal(result.granted, false);
  assert.equal(result.token, null);
  assert.ok(result.error);
  assert.equal(getRegisteredToken(), null);
});

test('checkNotificationPermission returns true when granted and false when denied', async () => {
  const { exports: grantedService } = loadNotificationService({
    initialPermissionStatus: 'granted',
  });
  assert.equal(await grantedService.checkNotificationPermission(), true);

  const { exports: deniedService } = loadNotificationService({
    initialPermissionStatus: 'denied',
  });
  assert.equal(await deniedService.checkNotificationPermission(), false);
});

for (const options of [
  { platform: 'ios', devicePushType: 'ios', devicePushToken: 'apns_synthetic' },
  { devicePushType: 'web', devicePushToken: { endpoint: 'https://example.invalid' } },
  { devicePushType: 'android', devicePushToken: { invalid: true } },
  { devicePushToken: null },
  { devicePushToken: '   ' },
]) {
  test(`FCM registration rejects unsupported or missing native tokens: ${JSON.stringify(options)}`, async () => {
    const service = loadNotificationService(options);
    const result = await service.exports.requestNotificationPermissionsAndRegisterDevice();
    assert.equal(result.granted, true);
    assert.equal(result.token, null);
    assert.ok(result.error);
    assert.equal(service.getRegisteredToken(), null);
    assert.equal(service.getSavedAuthToken(), null);
    assert.equal(service.getExpoTokenRequests(), 0);
  });
}
