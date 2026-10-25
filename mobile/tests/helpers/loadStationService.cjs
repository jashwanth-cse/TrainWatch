const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function loadStationService(storage) {
  const values = new Map();
  const asyncStorage = storage ?? {
    getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); },
  };
  const filePath = require.resolve('../../src/services/stationService.ts');
  const source = fs.readFileSync(filePath, 'utf8');
  const stationsData = require('../../src/data/stations.json');

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const exports = {};
  const modules = {
    '../data/stations.json': stationsData,
    '@react-native-async-storage/async-storage': asyncStorage,
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

module.exports = { loadStationService };
