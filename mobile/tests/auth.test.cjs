const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Execute service boundaries with synthetic storage and identity providers.
function load(file, modules, env = {}) {
  const source = readFileSync(path.join(path.dirname(require.resolve('../package.json')), file), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  const exports = {};
  vm.runInNewContext(outputText, {
    exports,
    require(name) {
      assert.ok(name in modules, `Unexpected dependency: ${name}`);
      return modules[name];
    },
    process: { env },
  });
  return exports;
}

function fixture({ configured = true, user = null, signInError, signOutError } = {}) {
  const calls = [];
  const storage = {
    async removeItem(key) { calls.push(['remove', key]); },
    async getItem(key) { calls.push(['get', key]); return null; },
    async setItem(key, value) { calls.push(['set', key, value]); },
  };
  const auth = { currentUser: user, async authStateReady() { calls.push(['ready']); } };
  const { authService } = load('src/services/authService.ts', {
    '@react-native-async-storage/async-storage': storage,
    './firebaseApp': { isFirebaseConfigured: () => configured },
    './firebaseClient': { getFirebaseAuth: () => auth },
    './googleIdentity': {
      async signInGoogleIdentity(actual) {
        assert.equal(actual, auth);
        if (signInError) throw signInError;
        return user;
      },
      async signOutGoogleIdentity(actual) {
        assert.equal(actual, auth);
        if (signOutError) throw signOutError;
        calls.push(['signOut']);
      },
    },
  });
  return { authService, calls };
}

function googleUser() {
  return {
    uid: 'synthetic-google-user', email: 'traveler@example.invalid',
    displayName: 'Synthetic Traveler', photoURL: null,
    providerData: [{ providerId: 'google.com' }],
    metadata: { creationTime: '2026-10-24T00:00:00.000Z' },
    async getIdToken(forceRefresh) { assert.equal(forceRefresh, true); return 'synthetic-token'; },
  };
}

test('unconfigured startup discards the legacy demo session without authenticating', async () => {
  const { authService, calls } = fixture({ configured: false });
  assert.equal(await authService.loadPersistedSession(), null);
  assert.equal(authService.getCurrentUser(), null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'remove');
});

test('sign-in returns only the provider identity and does not save a profile as authentication', async () => {
  const { authService, calls } = fixture({ user: googleUser() });
  const profile = await authService.signInWithGoogle();
  assert.equal(profile.uid, 'synthetic-google-user');
  assert.equal(profile.createdAt, '2026-10-24T00:00:00.000Z');
  assert.equal(authService.getCurrentUser(), profile);
  assert.ok(!calls.some(([operation]) => operation === 'set'));
});

test('provider failure never creates a current user or persists a fake profile', async () => {
  const { authService, calls } = fixture({ signInError: new Error('cancelled') });
  await assert.rejects(authService.signInWithGoogle(), /cancelled/);
  assert.equal(authService.getCurrentUser(), null);
  assert.equal(calls.length, 0);
});

test('restoration waits for Firebase and verifies its token before using the Google profile', async () => {
  const { authService, calls } = fixture({ user: googleUser() });
  assert.equal((await authService.loadPersistedSession()).uid, 'synthetic-google-user');
  assert.equal(calls[0][0], 'remove');
  assert.equal(calls[1][0], 'ready');
});

test('expired or revoked Firebase restoration does not authenticate', async () => {
  const user = googleUser();
  user.getIdToken = async () => { throw new Error('revoked'); };
  const { authService } = fixture({ user });
  await assert.rejects(authService.loadPersistedSession(), /revoked/);
  assert.equal(authService.getCurrentUser(), null);
});

test('non-Google providers are rejected', async () => {
  const user = googleUser();
  user.providerData = [{ providerId: 'password' }];
  const { authService } = fixture({ user });
  await assert.rejects(authService.signInWithGoogle(), /verified Google account/);
  assert.equal(authService.getCurrentUser(), null);
});

test('successful sign-out clears the current user', async () => {
  const { authService } = fixture({ user: googleUser() });
  await authService.signInWithGoogle();
  await authService.signOut();
  assert.equal(authService.getCurrentUser(), null);
});

test('failed sign-out rejects so the UI can offer recovery', async () => {
  const { authService } = fixture({ user: googleUser(), signOutError: new Error('storage unavailable') });
  const profile = await authService.signInWithGoogle();
  await assert.rejects(authService.signOut(), /storage unavailable/);
  assert.equal(authService.getCurrentUser(), profile);
});

function nativeIdentity(response, env = { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: 'synthetic-client' }) {
  const calls = [];
  const verifiedUser = googleUser();
  const { signInGoogleIdentity } = load('src/services/googleIdentity.native.ts', {
    'react-native': { Platform: { OS: 'android' } },
    'firebase/auth': {
      GoogleAuthProvider: { credential(token) { calls.push(['credential', token]); return token; } },
      async signInWithCredential(auth, credential) {
        calls.push(['exchange', auth, credential]);
        return { user: verifiedUser };
      },
    },
    '@react-native-google-signin/google-signin': {
      isSuccessResponse: (value) => value.type === 'success',
      GoogleSignin: {
        configure() {},
        async hasPlayServices() {},
        async signIn() { return response; },
      },
    },
  }, env);
  return { signInGoogleIdentity, calls, verifiedUser };
}

test('native Google tokens must be exchanged with Firebase before a user is returned', async () => {
  const { signInGoogleIdentity, calls, verifiedUser } = nativeIdentity({
    type: 'success', data: { idToken: 'synthetic-google-token', user: { id: 'untrusted-local-profile' } },
  });
  const auth = {};
  assert.equal(await signInGoogleIdentity(auth), verifiedUser);
  assert.equal(calls[0][1], 'synthetic-google-token');
  assert.equal(calls[1][0], 'exchange');
  assert.equal(calls[1][1], auth);
});

for (const [name, response, error] of [
  ['cancellation', { type: 'cancelled' }, /cancelled/],
  ['missing token', { type: 'success', data: { idToken: null } }, /identity token/],
]) {
  test(`native ${name} cannot authenticate with Firebase`, async () => {
    const { signInGoogleIdentity, calls } = nativeIdentity(response);
    await assert.rejects(signInGoogleIdentity({}), error);
    assert.equal(calls.length, 0);
  });
}

test('missing OAuth configuration cannot start native Google sign-in', async () => {
  const { signInGoogleIdentity, calls } = nativeIdentity(null, {});
  await assert.rejects(signInGoogleIdentity({}), /not configured/);
  assert.equal(calls.length, 0);
});
