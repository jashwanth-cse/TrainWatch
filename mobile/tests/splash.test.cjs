const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

// Drive hooks and native animation completions without real timers or providers.
function fixture() {
  const hooks = [];
  const animations = [];
  let cursor = 0;
  let effects = [];
  const changed = (a, b) => !b || a.some((value, i) => !Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState(initial) {
      const slot = cursor++;
      if (!(slot in hooks)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], (value) => { hooks[slot] = value; }];
    },
    useCallback(callback, deps) {
      const slot = cursor++;
      if (changed(deps, hooks[slot]?.deps)) hooks[slot] = { callback, deps };
      return hooks[slot].callback;
    },
    useEffect(effect, deps) {
      const slot = cursor++;
      if (changed(deps, hooks[slot]?.deps)) {
        effects.push(() => {
          hooks[slot]?.cleanup?.();
          hooks[slot] = { deps, cleanup: effect() };
        });
      }
    },
  };
  function animation(kind, value, config) {
    const result = {
      kind, value, config,
      start(callback) { this.callback = callback; animations.push(this); },
      finish(finished = true) {
        if (finished && value) value.current = config.toValue;
        this.callback?.({ finished });
      },
      stop() { this.stopped = true; this.finish(false); },
    };
    return result;
  }
  const native = {
    View: 'View', Text: 'Text', Image: 'Image', ActivityIndicator: 'ActivityIndicator',
    StyleSheet: { create: (styles) => styles },
    Dimensions: { get: () => ({ width: 390 }) },
    Animated: {
      View: 'Animated.View',
      Value: class { constructor(value) { this.current = value; } },
      timing: (value, config) => animation('timing', value, config),
      spring: () => animation('spring'),
      sequence: () => animation('sequence'),
      parallel: () => animation('parallel'),
      delay: () => animation('delay'),
      loop: () => animation('loop'),
    },
  };
  const auth = { isLoading: true };
  const modules = {
    react,
    'react-native': native,
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    'expo-status-bar': { StatusBar: 'StatusBar' },
    'expo-router': { Stack: 'Stack' },
    'react-native-safe-area-context': { SafeAreaProvider: 'SafeAreaProvider' },
    '../services/AuthContext': { AuthProvider: 'AuthProvider', useAuth: () => auth },
    '../services/backendWarmupService': { initBackendWarmup: () => () => {} },
    '../services/notificationService': { initializeNotificationChannel: async () => {}, checkNotificationPermission: async () => false, requestNotificationPermissionsAndRegisterDevice: async () => ({ granted: true }) },
    '../theme/tokens': { colors: { background: '#fff' } },
    '../../assets/brand-emblem.png': 'synthetic-emblem',
  };
  function load(file) {
    const source = readFileSync(path.join(path.dirname(require.resolve('../package.json')), file), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.React, esModuleInterop: true,
      },
    });
    const exports = {};
    vm.runInNewContext(outputText, {
      exports,
      require(name) {
        assert.ok(name in modules, `Unexpected dependency: ${name}`);
        return modules[name];
      },
    });
    return exports;
  }
  const { SplashScreen } = load('src/components/SplashScreen.tsx');
  modules['../components/SplashScreen'] = { SplashScreen };
  const { default: RootLayout } = load('src/app/_layout.tsx');
  return {
    auth, animations, SplashScreen, RootLayout,
    render(Component, props = {}) {
      cursor = 0;
      const tree = Component(props);
      const pending = effects;
      effects = [];
      pending.forEach((effect) => effect());
      return tree;
    },
    unmount() { hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

for (const sessionFirst of [false, true]) {
  test(`splash waits for both prerequisites when ${sessionFirst ? 'session' : 'animation'} finishes first`, () => {
    const f = fixture();
    let completions = 0;
    const props = { readyToDismiss: sessionFirst, onAnimationComplete: () => completions++ };
    const tree = f.render(f.SplashScreen, props);
    const opacity = tree.props.style[1].opacity;
    assert.equal(opacity.current, 1);
    assert.equal(f.animations.length, 2); // Ambient loop and entrance only.
    f.animations.find((item) => item.kind === 'sequence').finish();
    f.render(f.SplashScreen, props);
    if (!sessionFirst) {
      assert.equal(f.animations.length, 2);
      assert.equal(opacity.current, 1);
      assert.equal(completions, 0);
      props.readyToDismiss = true;
      f.render(f.SplashScreen, props);
    }
    const exit = f.animations.at(-1);
    assert.equal(exit.kind, 'timing');
    assert.equal(exit.value, opacity);
    assert.equal(exit.config.toValue, 0);
    assert.equal(completions, 0);
    exit.finish();
    assert.equal(completions, 1);
    f.unmount();
    assert.ok(f.animations.every((item) => item.stopped));
  });
}

test('interrupted entrance or exit does not dismiss the splash', () => {
  const f = fixture();
  let completions = 0;
  const props = { readyToDismiss: true, onAnimationComplete: () => completions++ };
  f.render(f.SplashScreen, props);
  const entrance = f.animations.find((item) => item.kind === 'sequence');
  entrance.finish(false);
  f.render(f.SplashScreen, props);
  assert.equal(f.animations.length, 2);
  entrance.finish();
  f.render(f.SplashScreen, props);
  f.unmount();
  assert.equal(completions, 0);
});

test('root uses auth readiness and does not replay the splash on later auth loading', () => {
  const f = fixture();
  const root = f.RootLayout();
  const content = root.props.children[0].props.children[0];
  let tree = f.render(content.type);
  const splash = tree.props.children[1];
  assert.equal(splash.type, f.SplashScreen);
  assert.equal(splash.props.readyToDismiss, false);
  f.auth.isLoading = false; // Restoration succeeds, returns no session, or rejects.
  tree = f.render(content.type);
  assert.equal(tree.props.children[1].props.readyToDismiss, true);
  assert.equal(tree.props.children[1].props.onAnimationComplete, splash.props.onAnimationComplete);
  splash.props.onAnimationComplete();
  tree = f.render(content.type);
  assert.equal(tree.props.children[1], false);
  f.auth.isLoading = true;
  tree = f.render(content.type);
  assert.equal(tree.props.children[1], false);
});
