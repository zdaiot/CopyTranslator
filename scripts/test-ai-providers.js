const assert = require('assert').strict;
const fs = require('fs'), vm = require('vm'), ts = require('typescript');
const quiet = {log() {}, debug() {}, warn() {}, error() {}};
function load(file, mocks = {}, type = 'browser') {
  const source = fs.readFileSync(file, 'utf8');
  const script = file.endsWith('.vue') ? require('vue-template-compiler').parseComponent(source).script.content : source;
  const code = ts.transpileModule(script, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require: id => mocks[id] || require(id), process: {...process, type}, console: quiet, setTimeout, clearTimeout, URL}, {filename: file});
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const provider = () => ({id: 'test-provider', name: 'Test provider', providerType: 'custom', apiBase: 'https://unit.test/v1', apiKey: 'fake-key', enabledModels: [], enabled: true, config: {}});

async function run() {
  // Use the real translation adapter with an in-memory HTTP transport. No keys,
  // settings files, or external services are accessed by these regression tests.
  const calls = [];
  const transport = {post: async (url, body, options) => {
    calls.push({url, body, options});
    return {data: {choices: [{message: {content: '测试译文'}}]}};
  }};
  const lib = require('@opentranslate2/translator');
  const adapter = load('src/common/translate/openai.ts', {'./types': {...lib, BaseTranslator: lib.Translator}});
  const data = {translatorProviders: [], customTranslators: []};
  let manager;
  const config = {
    get: key => data[key],
    set: (key, value) => {
      data[key] = plain(value);
      if (key === 'translatorProviders' && manager) manager.reload();
      return true;
    },
  };
  manager = load('src/common/translate/custom-translators.ts', {
    '../configuration': {__esModule: true, default: config},
    '../event-bus': {__esModule: true, default: {once() {}}},
    './openai': adapter, './proxy': {axios: transport},
  }).customTranslatorManager;
  assert(manager.addProvider(provider()));
  assert(manager.setEnabledModels('test-provider', ['model-a', 'model-b']));
  assert.deepEqual(data.customTranslators, ['test-provider-model-a', 'test-provider-model-b']);
  const translator = manager.getTranslator('test-provider-model-b');
  const result = await translator.translate('Hello, world!', 'en', 'zh-CN');
  assert.equal(result.trans.paragraphs[0], '测试译文');
  assert.equal(calls[0].url, 'https://unit.test/v1/chat/completions');
  assert.equal(calls[0].body.model, 'model-b');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-key');
  assert(calls[0].body.messages[0].content.includes('Simplified Chinese'));
  assert(manager.setEnabledModels('test-provider', ['model-b']));
  assert(!manager.isCustomTranslator('test-provider-model-a'), 'Disabled models must leave the config and instance caches');
  assert.deepEqual(data.customTranslators, ['test-provider-model-b']);
  manager.updateProvider('test-provider', {enabled: false});
  assert.deepEqual(data.customTranslators, []);
  assert.equal(manager.getAllProviders().length, 1, 'A disabled provider remains editable');
  manager.updateProvider('test-provider', {enabled: true, name: 'Renamed provider'});
  assert.equal(manager.getConfig('test-provider-model-b').name, 'Renamed provider - model-b');

  // Renderer reloads refresh display names without echoing derived config writes.
  const rendererWrites = [];
  const renderer = load('src/common/translate/custom-translators.ts', {
    '../configuration': {__esModule: true, default: {get: key => data[key], set: (key, value) => rendererWrites.push({key, value})}},
    '../event-bus': {__esModule: true, default: {once() {}}},
  }, 'renderer').customTranslatorManager;
  renderer.reload();
  assert.equal(renderer.getConfig('test-provider-model-b').name, 'Renamed provider - model-b');
  assert.equal(rendererWrites.length, 0, 'Renderer reload must not create shared-mutation loops');
  renderer.setEnabledModels('test-provider', []);
  assert.equal(renderer.getAllIds().length, 0, 'Renderer metadata also drops disabled models without a restart');
  assert.deepEqual(data.translatorProviders[0].enabledModels, ['model-b'], 'Edits must not mutate the shared store before saving');

  // Provider UI must preserve all fetched choices after each model toggle.
  const view = load('src/components/CustomTranslatorManager.vue', {
    electron: {ipcRenderer: {invoke: async () => ({ok: true, models: ['model-a', 'model-b', 'model-c']})}},
    '@/common/translate/custom-translators': {customTranslatorManager: manager},
    '@/common/translate/provider-config': load('src/common/translate/provider-config.ts'),
    '@/common/translate/provider-templates': {providerTemplates: [], getProviderTemplate: () => undefined},
    '@/common/event-bus': {__esModule: true, default: {at() {}}},
  }, 'renderer').default.options;
  const ctx = {providers: [], trans: {}};
  Object.entries(view.methods).forEach(([key, value]) => { ctx[key] = value.bind(ctx); });
  ctx.loadProviders();
  await ctx.fetchProviderModels(ctx.providers[0]);
  ctx.updateProviderModels('test-provider', ['model-a']);
  assert.deepEqual(plain(ctx.providers[0].availableModels).sort(), ['model-a', 'model-b', 'model-c']);
  ctx.updateProviderModels('test-provider', ['model-a', 'model-c']);
  assert.deepEqual(data.customTranslators, ['test-provider-model-a', 'test-provider-model-c']);
  ctx.providers[0].manualModel = '  gateway/custom-model  ';
  ctx.addManualModel(ctx.providers[0]);
  assert(data.customTranslators.includes('test-provider-gateway/custom-model'));
  assert.equal(ctx.providers[0].manualModel, '');
  ctx.loadProviders();
  assert(ctx.providers[0].availableModels.includes('model-b'), 'Refreshing provider UI must retain fetched, unselected models');

  // Translation models stay available while smart dictionary is showing a word.
  const Vue = require('vue');
  const emptyVue = {__esModule: true, default: Vue.extend({})};
  const menuMocks = Object.fromEntries(['ActionButton', 'ContrastPanel', 'BaseView', 'WindowController', 'Action', 'SelectionControls', 'EngineButton'].map(name => [`../components/${name}.vue`, emptyVue]));
  const menu = load('src/views/Contrast.vue', {
    ...menuMocks, '@/components/Tips.vue': emptyVue, '@/css/shared-styles.css': {},
    '../common/types': {abstractTranslatorTypes: ['copytranslator']},
    '../common/dictionary/types': {dictionaryTypes: ['youdao']},
    '../common/translate/translator-name-resolver': {TranslatorNameResolver: {isBuiltInTranslator: id => id === 'baidu'}},
  }, 'renderer').default.options;
  const engineConfig = {'translator-enabled': ['baidu', 'removed-model'], customTranslators: ['test-provider-model-a']};
  const groups = menu.computed.engineGroups.get.call({config: engineConfig, isChinese: true, valid: true});
  assert(groups.find(group => group.key === 'dictionary').items.includes('youdao'));
  assert(groups.find(group => group.key === 'ai').items.includes('test-provider-model-a'));
  assert(!groups.find(group => group.key === 'translation').items.includes('removed-model'));
  const actions = [];
  menu.methods.chooseEngine.call({config: engineConfig, valid: false, callback: (...args) => actions.push(args)}, 'test-provider-model-a', false);
  assert.deepEqual(actions, [['smartDict', false], ['multiSource', false], ['translatorType', 'test-provider-model-a']], 'Choosing AI also routes individual words to AI');
  assert.equal(menu.computed.valid.get.call({mode: 'dict', config: {contrastDict: false}}), true, 'Dictionary detection must match the displayed current engine in every layout');
  manager.removeProvider('test-provider');
  assert.deepEqual(data.customTranslators, []);
  assert.equal(manager.getAllIds().length, 0);
  console.log('PASS: AI model enable/disable/remove, disabled-provider retention, renderer synchronization, fetched-list preservation, manual model IDs, main menu/dictionary routing, real adapter request and response.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
