const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

function loadAuthService(storageMap = new Map()) {
  const filePath = path.join(__dirname, '../src/services/authService.ts');
  const source = readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const storage = {
    async getItem(key) {
      return storageMap.has(key) ? storageMap.get(key) : null;
    },
    async setItem(key, value) {
      storageMap.set(key, String(value));
    },
    async removeItem(key) {
      storageMap.delete(key);
    },
  };

  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name === '@react-native-async-storage/async-storage') {
        return storage;
      }
      return require(name);
    },
  });

  return { authService: exports.authService, storageMap };
}

test('initial startup generates and persists a unique device identifier', async () => {
  const { authService, storageMap } = loadAuthService();
  const session = await authService.loadPersistedSession();

  assert.ok(session);
  assert.ok(session.uid.startsWith('tw_'));
  assert.equal(session.displayName, 'Traveler');
  assert.ok(storageMap.has('@trainwatch_device_id'));
  assert.equal(storageMap.get('@trainwatch_device_id'), session.uid);
});

test('subsequent startups preserve the existing device identifier', async () => {
  const storageMap = new Map([['@trainwatch_device_id', 'tw_existing_device_123']]);
  const { authService } = loadAuthService(storageMap);

  const session = await authService.loadPersistedSession();
  assert.equal(session.uid, 'tw_existing_device_123');

  const deviceId = await authService.getDeviceId();
  assert.equal(deviceId, 'tw_existing_device_123');
});

test('FCM token persistence attaches token to current device profile', async () => {
  const { authService, storageMap } = loadAuthService();
  await authService.loadPersistedSession();

  await authService.setFcmToken('fcm_token_sample_abc');
  assert.equal(storageMap.get('@trainwatch_fcm_token'), 'fcm_token_sample_abc');

  const retrieved = await authService.getFcmToken();
  assert.equal(retrieved, 'fcm_token_sample_abc');
  assert.equal(authService.getCurrentUser().fcmToken, 'fcm_token_sample_abc');
});

test('signOut / session reset generates a new device identity', async () => {
  const storageMap = new Map([['@trainwatch_device_id', 'tw_initial_id']]);
  const { authService } = loadAuthService(storageMap);
  await authService.loadPersistedSession();

  await authService.signOut();
  const newProfile = authService.getCurrentUser();

  assert.ok(newProfile.uid !== 'tw_initial_id');
  assert.ok(newProfile.uid.startsWith('tw_'));
});
