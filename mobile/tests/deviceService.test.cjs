const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');

function loadDeviceService(mockFetch, mockDeviceId = 'device_xyz_789') {
  const filePath = path.join(__dirname, '../src/services/deviceService.ts');
  const source = fs.readFileSync(filePath, 'utf8');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  let savedFcm = null;
  const modules = {
    './authService': {
      authService: {
        getDeviceId: async () => mockDeviceId,
        setFcmToken: async (t) => { savedFcm = t; },
      },
    },
  };

  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      if (name in modules) return modules[name];
      return require(name);
    },
    fetch: mockFetch,
    process: { env: {} },
    JSON,
    Error,
  });

  return { exports, getSavedFcm: () => savedFcm };
}

test('registerDeviceToken sends PUT request with device auth header and token payload', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'registered', device_id: 'device_xyz_789' }),
    };
  };

  const { exports, getSavedFcm } = loadDeviceService(mockFetch);
  const success = await exports.registerDeviceToken('fcm_token_sample_123', 'android');

  assert.equal(success, true);
  assert.equal(capturedUrl, 'https://dream-destiny.cloud.run/api/v1/devices/device_xyz_789');
  assert.equal(capturedOptions.method, 'PUT');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer device_xyz_789');
  const body = JSON.parse(capturedOptions.body);
  assert.equal(body.fcm_token, 'fcm_token_sample_123');
  assert.equal(body.platform, 'android');
  assert.equal(getSavedFcm(), 'fcm_token_sample_123');
});

test('registerDeviceToken returns false when token is empty or fetch fails', async () => {
  const { exports: ex1 } = loadDeviceService(async () => ({ ok: true }));
  const blankRes = await ex1.registerDeviceToken('   ');
  assert.equal(blankRes, false);

  const { exports: ex2 } = loadDeviceService(async () => {
    throw new Error('Network error');
  });
  const failRes = await ex2.registerDeviceToken('valid_token');
  assert.equal(failRes, false);
});

test('revokeDeviceToken sends DELETE request to device endpoint', async () => {
  let capturedUrl = '';
  let capturedOptions = null;

  const mockFetch = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'revoked', device_id: 'device_xyz_789' }),
    };
  };

  const { exports } = loadDeviceService(mockFetch);
  const success = await exports.revokeDeviceToken();

  assert.equal(success, true);
  assert.equal(capturedUrl, 'https://dream-destiny.cloud.run/api/v1/devices/device_xyz_789');
  assert.equal(capturedOptions.method, 'DELETE');
  assert.equal(capturedOptions.headers.Authorization, 'Bearer device_xyz_789');
});
