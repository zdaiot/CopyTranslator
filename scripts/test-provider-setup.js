const assert = require('assert').strict;
const fs = require('fs'), vm = require('vm'), ts = require('typescript');
const chatMocks = {};
const quiet = {log() {}, debug() {}, warn() {}, error() {}};
function load(file, mocks = {}, platform = process.platform) {
  const source = fs.readFileSync(file, 'utf8');
  const script = file.endsWith('.vue') ? require('vue-template-compiler').parseComponent(source).script.content : source;
  const code = ts.transpileModule(script, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require: id => mocks[id] || chatMocks[id] || require(id), process: {...process, type: 'browser', platform}, console: quiet, setTimeout, clearTimeout, URL, Buffer, AbortController, Error}, {filename: file});
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };

for (const name of ['chat-settings', 'provider-http', 'chat-stream', 'chat-request']) {
  chatMocks['./' + name] = load('src/common/translate/' + name + '.ts');
  chatMocks['@/common/translate/' + name] = chatMocks['./' + name];
}

async function run() {
  const config = load('src/common/translate/provider-config.ts');
  const fakeKey = 'fake-secret-for-tests';
  assert.deepEqual(plain(config.normalizeProviderConnection(' https://unit.test/v1/chat/completions/ ', ` ${fakeKey} `)), {apiBase: 'https://unit.test/v1', apiKey: fakeKey});
  assert.throws(() => config.normalizeProviderConnection('file:///tmp/config', fakeKey));
  assert.throws(() => config.normalizeProviderConnection('https://user:password@unit.test', fakeKey));
  assert.throws(() => config.normalizeProviderConnection('https://unit.test', '  '));
  assert.deepEqual(plain(config.normalizeModelIds([' a ', 'a', '', null, {id: 'bad'}, 'gateway/model'])), ['a', 'gateway/model']);

  const calls = [];
  let modelsData = {data: [{id: 'b'}, {id: 'a'}, {id: ' a '}, {id: null}, null]};
  let failure, chatData = {choices: [{message: {content: '你好'}}]};
  const transport = {defaults: {}, get: async (url, options) => {calls.push({url, options}); if (failure) throw failure; return {data: modelsData};}, post: async (url, body, options) => {calls.push({url, body, options}); if (failure) throw failure; return {data: chatData};}};
  const connection = load('src/common/translate/provider-connection.ts', {'./proxy': {axios: transport}, './provider-config': config});
  const fetcher = load('src/common/translate/model-fetcher.ts', {'./proxy': {axios: transport}, './provider-connection': connection});
  assert.deepEqual(plain(await fetcher.fetchModels('https://unit.test/v1/', fakeKey)), ['a', 'b']);
  assert.equal(calls[0].url, 'https://unit.test/v1/models');
  assert.equal(calls[0].options.headers.Authorization, `Bearer ${fakeKey}`);
  assert.equal(calls[0].options.maxRedirects, 0);
  const provider = {apiBase: 'https://unit.test/v1', apiKey: fakeKey, config: {temperature: 0.2, maxTokens: 80}};
  const tested = await connection.testProviderConnection(provider, 'gateway/model');
  assert.equal(tested.text, '你好');
  assert.equal(calls[1].body.model, 'gateway/model');
  assert.equal(calls[1].body.max_tokens, 80);
  assert.equal(calls[1].body.stream, true);
  assert.equal(calls[1].options.timeout, 60000);
  for (const status of [400, 401, 403, 404, 429, 500]) {
    failure = {response: {status, data: {error: {message: fakeKey}}}, message: fakeKey, config: {headers: {Authorization: fakeKey}}};
    await assert.rejects(fetcher.fetchModels(provider.apiBase, fakeKey), e => !!e.message && !e.message.includes(fakeKey));
    await assert.rejects(connection.testProviderConnection(provider, 'a'), e => !!e.message && !e.message.includes(fakeKey));
  }
  failure = {code: 'ECONNABORTED', message: fakeKey};
  await assert.rejects(connection.testProviderConnection(provider, 'a'), /超时/);
  failure = undefined;
  modelsData = {unexpected: []};
  await assert.rejects(fetcher.fetchModels(provider.apiBase, fakeKey), /模型列表/);
  chatData = {choices: [{message: {content: ''}}]};
  await assert.rejects(connection.testProviderConnection(provider, 'a'), /没有返回文本/);
  chatData = {choices: [{message: {content: fakeKey}}]};
  assert(!(await connection.testProviderConnection(provider, 'a')).text.includes(fakeKey));

  const handlers = new Map();
  const sender = {};
  load('src/main/provider-api.ts', {electron: {ipcMain: {handle: (name, handler) => handlers.set(name, handler)}}, '../common/translate/model-fetcher': fetcher, '../common/translate/provider-connection': connection}).registerProviderAPI(candidate => candidate === sender);
  const before = calls.length;
  await assert.rejects(handlers.get('ai-provider:models')({sender: {}}, provider), /settings window/);
  assert.equal(calls.length, before, 'Untrusted windows cannot send credentials or requests');
  modelsData = {data: [{id: 'chat'}]};
  assert.equal((await handlers.get('ai-provider:models')({sender}, provider)).models[0], 'chat');
  failure = {response: {status: 401}};
  assert.equal((await handlers.get('ai-provider:test')({sender}, provider, 'chat')).ok, false);
  failure = undefined;

  // Model discovery and connection tests work before saving, and late responses
  // cannot replace data after credentials/template changes or dialog closure.
  let invoke = async () => ({ok: true, models: ['chat-a', 'chat-b']});
  let clipboardReads = 0, saves = 0;
  const savedProviders = [];
  const view = load('src/components/CustomTranslatorManager.vue', {
    electron: {clipboard: {readText: () => {clipboardReads++; return ` ${fakeKey} `;}}, ipcRenderer: {invoke: (...args) => invoke(...args)}},
    '@/common/translate/provider-config': config,
    '@/common/translate/custom-translators': {customTranslatorManager: {
      addProvider: value => {saves++; savedProviders.push(plain(value)); return true;},
      getProvider: id => savedProviders.find(p => p.id === id),
      updateProvider: (id, updates) => {
        const index = savedProviders.findIndex(p => p.id === id);
        if (index < 0) return false;
        savedProviders[index] = {...savedProviders[index], ...plain(updates)};
        return true;
      },
      generateUniqueProviderId: base => base + '-test', getAllProviders: () => savedProviders,
    }},
    '@/common/translate/provider-templates': {providerTemplates: [], getProviderTemplate: () => undefined},
    '@/common/event-bus': {__esModule: true, default: {at() {}}},
  }).default.options;
  const ctx = {providerForm: {...provider, enabledModels: ['manual-model']}, draftModels: [], draftModelSearch: '', modelRequestVersion: 0, testRequestVersion: 0, testingDraft: false, fetchingDraftModels: false, draftTestModel: '', isChinese: true, trans: {}};
  Object.entries(view.methods).forEach(([key, value]) => {ctx[key] = value.bind(ctx);});
  for (const key of ['canConnect', 'hasDraftModel', 'draftModelItems', 'draftTestModelId']) Object.defineProperty(ctx, key, {get: () => view.computed[key].get.call(ctx)});
  assert.equal(clipboardReads, 0);
  ctx.pasteApiKey(); assert.equal(clipboardReads, 1); assert.equal(ctx.providerForm.apiKey, fakeKey);
  await ctx.fetchDraftModels();
  assert.deepEqual(plain(ctx.draftModelItems), ['chat-a', 'chat-b', 'manual-model']);
  assert.equal(saves, 0, 'Fetching a list must not save a draft');
  let pending = deferred(); invoke = () => pending.promise;
  let running = ctx.fetchDraftModels();
  ctx.providerForm.apiKey = 'changed-key'; ctx.invalidateDraftConnection();
  pending.resolve({ok: true, models: ['stale-model']}); await running;
  assert.deepEqual(plain(ctx.draftModels), []);
  invoke = async (channel, payload, model) => {assert.equal(channel, 'ai-provider:test'); assert.equal(model, 'manual-model'); return {ok: true, model, elapsedMs: 150, text: '你好'};};
  await ctx.testDraftConnection(); assert(ctx.draftTestResult.includes('连接成功')); assert.equal(saves, 0);
  pending = deferred(); invoke = () => pending.promise;
  running = ctx.testDraftConnection(); ctx.invalidateDraftConnection();
  pending.resolve({ok: true, model: 'manual-model', elapsedMs: 10, text: 'stale success'}); await running;
  assert.equal(ctx.draftTestResult, '');
  ctx.providerForm.enabledModels = []; ctx.draftModelSearch = '  gateway/new-model  '; ctx.commitDraftModelSearch();
  assert.deepEqual(plain(ctx.providerForm.enabledModels), ['gateway/new-model']);
  ctx.$refs = {form: {validate: () => true}};
  ctx.providers = [];
  ctx.providerForm = {...provider, id: '', name: ' Test provider ', providerType: 'custom', enabledModels: [], enabled: true};
  ctx.draftModelSearch = ' gateway/typed-before-save ';
  ctx.showAddProviderDialog = true;
  ctx.saveProvider();
  assert.equal(saves, 1);
  assert.deepEqual(savedProviders[0].enabledModels, ['gateway/typed-before-save'], 'Saving commits a manually typed model even before Enter');
  assert.equal(savedProviders[0].name, 'Test provider');
  assert.equal(ctx.showAddProviderDialog, false);
  assert.equal(ctx.providerForm.apiKey, '', 'Closing a saved draft clears credentials from the form');

  // Discovery in the add dialog is saved with the provider, including choices
  // that were not enabled. Returning to either view needs no second API call.
  ctx.providerForm = {...provider, id: '', name: 'Cached provider', providerType: 'custom', enabledModels: ['chat-a']};
  let discoveries = 0;
  invoke = async () => {discoveries++; return {ok: true, models: ['chat-a', 'chat-b', 'chat-c']};};
  await ctx.fetchDraftModels();
  invoke = async () => ({ok: false, error: 'offline'});
  await ctx.fetchDraftModels();
  assert.deepEqual(plain(ctx.draftModels), ['chat-a', 'chat-b', 'chat-c'], 'Failed draft refresh preserves the last successful list');
  invoke = async () => ({ok: true, models: []});
  await ctx.fetchDraftModels();
  assert.deepEqual(plain(ctx.draftModels), ['chat-a', 'chat-b', 'chat-c'], 'Empty responses must not erase saved choices');
  invoke = async () => {throw new Error('Unexpected network call while reopening');};
  ctx.saveProvider();
  assert.deepEqual(savedProviders[1].availableModels, ['chat-a', 'chat-b', 'chat-c']);
  assert.deepEqual(savedProviders[1].enabledModels, ['chat-a'], 'Discovered models are not automatically enabled');
  ctx.providers = [];
  ctx.loadProviders();
  assert.deepEqual(plain(ctx.providers[1].availableModels), ['chat-a', 'chat-b', 'chat-c']);
  ctx.editProvider(ctx.providers[1]);
  const defaults = chatMocks['./chat-settings'].DEFAULT_TRANSLATION_PROMPT;
  assert.equal(ctx.providerForm.config.prompt, defaults, 'An existing empty prompt opens with the actual default template');
  assert.equal(ctx.providerForm.config.chatEnabled, true, 'Existing AI models support conversation by default');
  assert.equal(ctx.providerForm.config.chatPrompt, chatMocks['./chat-settings'].DEFAULT_CONTEXT_CHAT_PROMPT);
  ctx.providerForm.config.chatEnabled = false;
  ctx.providerForm.config.chatPrompt = 'My separate conversation prompt';
  ctx.providerForm.config.prompt = 'Translate {text} to {to} with care';
  ctx.providerForm.config.reasoningProtocol = 'deepseek';
  ctx.providerForm.config.reasoningEffort = 'none';
  assert.deepEqual(plain(ctx.draftModelItems), ['chat-a', 'chat-b', 'chat-c']);
  ctx.providerForm.name = 'Renamed cached provider';
  ctx.providerForm.enabledModels = ['chat-b'];
  ctx.saveProvider();
  assert.deepEqual(savedProviders[1].availableModels, ['chat-a', 'chat-b', 'chat-c'], 'Non-connection edits preserve the candidate list');
  assert.deepEqual(savedProviders[1].enabledModels, ['chat-b']);
  assert.equal(discoveries, 1);
  assert.equal('fetchingModels' in savedProviders[1], false, 'Transient UI state is never persisted');

  ctx.editProvider(ctx.providers[1]);
  assert.equal(ctx.providerForm.config.prompt, 'Translate {text} to {to} with care', 'Custom prompts survive save and reopen');
  assert.equal(ctx.providerForm.config.reasoningEffort, 'none', 'Reasoning preferences persist');
  assert.equal(ctx.providerForm.config.chatEnabled, false);
  assert.equal(ctx.providerForm.config.chatPrompt, 'My separate conversation prompt', 'Chat preferences survive save and reopen without replacing the translation prompt');
  ctx.draftTestResult = 'stale test'; ctx.restoreDefaultPrompt();
  assert.equal(ctx.providerForm.config.prompt, defaults);
  assert.equal(ctx.draftTestResult, '', 'Restoring the default invalidates the old connection test');
  ctx.$set = (target, key, value) => { target[key] = value; };
  ctx.draftTestResult = 'stale test'; ctx.setDraftStream(false);
  assert.equal(ctx.providerForm.config.stream, false);
  assert.equal(ctx.draftTestResult, '');
  ctx.providerForm.apiKey = 'replacement-key'; ctx.invalidateDraftConnection();
  ctx.saveProvider();
  assert.deepEqual(savedProviders[1].availableModels, ['chat-b'], 'Changing credentials drops old candidates but preserves the selected model');
  ctx.editProvider(ctx.providers[1]);
  ctx.providerForm.apiBase = 'https://another.test/v1'; ctx.invalidateDraftConnection();
  invoke = async () => ({ok: true, models: ['new-a', 'new-b']});
  await ctx.fetchDraftModels();
  ctx.providerForm.enabledModels = ['new-a'];
  ctx.saveProvider();
  assert.deepEqual(savedProviders[1].availableModels, ['new-a', 'new-b'], 'A new endpoint saves only its own fetched list');
  ctx.editProvider(ctx.providers[1]);
  ctx.providerForm.apiBase = 'https://third.test/v1'; ctx.invalidateDraftConnection();
  ctx.saveProvider();
  assert.deepEqual(savedProviders[1].availableModels, ['new-a'], 'Endpoint edits without discovery also invalidate old choices');

  // Native editing roles must be nested in a menu on macOS; saved custom
  // accelerators and deliberately disabled shortcuts are preserved on both OSes.
  for (const platform of ['darwin', 'win32']) {
    let appMenu;
    class Menu {constructor() {this.items = [];} append(item) {this.items.push(item);} static setApplicationMenu(menu) {appMenu = menu;}}
    class MenuItem {constructor(options) {Object.assign(this, options);}}
    const defaults = new Map([['paste', 'CmdOrCtrl+V'], ['copy', 'CmdOrCtrl+C'], ['selectAll', 'CmdOrCtrl+A']]);
    const Manager = load('src/main/shortcut.ts', {electron: {Menu, MenuItem}, '../common/types': {roles: ['paste', 'copy', 'selectAll']}, '../common/event-bus': {__esModule: true, default: {}}, '../common/env': {env: {}}, '../common/selection-shortcut': {}, '../common/shortcuts': {defaultLocalShortcuts: defaults}}, platform).ShortcutManager;
    const manager = new Manager(); manager.localShortcuts = new Map([['copy', 'CmdOrCtrl+Alt+C'], ['focus', 'F2']]); manager.registerLocalShortcuts();
    const edit = appMenu.items.find(item => item.role === 'editMenu').submenu;
    assert.equal(edit.items.find(item => item.role === 'paste').accelerator, 'CmdOrCtrl+V');
    assert.equal(edit.items.find(item => item.role === 'copy').accelerator, 'CmdOrCtrl+Alt+C');
    assert(appMenu.items.some(item => item.submenu?.items.some(action => action.id === 'focus')));
    assert.equal(appMenu.items.some(item => item.role === 'appMenu'), platform === 'darwin');
    manager.localShortcuts.set('paste', ''); manager.registerLocalShortcuts();
    assert.equal(appMenu.items.find(item => item.role === 'editMenu').submenu.items.find(item => item.role === 'paste').accelerator, '');
  }
  console.log('PASS: provider discovery, request shape, sanitized errors, timeouts, trusted IPC, draft testing, add/save/reopen model persistence, connection changes, stale responses, manual IDs, paste and native edit menus.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
