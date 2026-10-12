const assert = require('assert').strict;
const fs = require('fs'), vm = require('vm'), ts = require('typescript');
const {Readable, PassThrough} = require('stream');
const chatMocks = {};
const quiet = {log() {}, debug() {}, warn() {}, error() {}};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const plain = value => JSON.parse(JSON.stringify(value));
function load(file, mocks = {}) {
  const source = fs.readFileSync(file, 'utf8');
  const script = file.endsWith('.vue') ? require('vue-template-compiler').parseComponent(source).script.content : source;
  const code = ts.transpileModule(script, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true, esModuleInterop: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require: id => mocks[id] || chatMocks[id] || require(id), process, console: quiet, setTimeout, clearTimeout, URL, Buffer, AbortController, Error}, {filename: file});
  return module.exports;
}
const frame = (content, finish_reason = null) => `data: ${JSON.stringify({choices: [{index: 0, delta: {content}, finish_reason}]})}\r\n\r\n`;
const end = frame('', 'stop') + 'data: [DONE]\r\n\r\n';

for (const name of ['chat-settings', 'provider-http', 'chat-stream', 'chat-request']) {
  chatMocks['./' + name] = load('src/common/translate/' + name + '.ts');
  chatMocks['@/common/translate/' + name] = chatMocks['./' + name];
}

async function run() {
  const streamLib = load('src/common/translate/chat-stream.ts');
  const updates = [];
  const stream = new PassThrough();
  const reading = streamLib.readChatStream(stream, text => updates.push(text));
  stream.write(': keep-alive\r\n\r\ndata: {"choices":[{"delta":{"role":"assistant","reasoning_content":"hidden"}}]}\r\n\r\n');
  const chinese = Buffer.from(frame('你好'));
  for (let i = 0; i < chinese.length; i++) stream.write(chinese.subarray(i, i + 1));
  await wait(10);
  assert.deepEqual(updates, ['你好'], 'Translation appears before the server completes, with split UTF-8 intact');
  stream.write(frame('，世界！') + 'data: {"choices":[],"usage":{"total_tokens":3}}\r\n\r\n' + end);
  assert.equal(await reading, '你好，世界！');
  assert.equal(updates.at(-1), '你好，世界！');
  assert(!updates.some(text => text.includes('hidden')));
  assert(stream.destroyed);
  await assert.rejects(streamLib.readChatStream(Readable.from([frame('partial')]), () => {}), /中断/);
  await assert.rejects(streamLib.readChatStream(Readable.from(['data: invalid-json\n\n']), () => {}), /格式/);
  await assert.rejects(streamLib.readChatStream(Readable.from([frame('partial', 'length')]), () => {}), /Token/);
  await assert.rejects(streamLib.readChatStream(Readable.from(['data: {"error":{"message":"fake-secret"}}\n\n']), () => {}), error => !error.message.includes('fake-secret'));
  const cancelled = new PassThrough(), abort = new AbortController();
  const pending = streamLib.readChatStream(cancelled, () => {}, abort.signal);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  abort.abort(); await rejected; assert(cancelled.destroyed);
  assert.equal(await streamLib.readChatStream(Readable.from([JSON.stringify({choices: [{message: {content: 'non-streaming result'}}]})]), () => {}, undefined, true), 'non-streaming result');

  // Exercise real HTTP/axios streaming against a local test server, including
  // gateways that ignore stream=true and servers that reject a credential.
  const lib = require('@opentranslate2/translator');
  const {OpenAI} = load('src/common/translate/openai.ts', {'./types': {...lib, BaseTranslator: lib.Translator}, './chat-stream': streamLib});
  const requests = [];
  const server = require('http').createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const payload = JSON.parse(body); requests.push(payload);
      if (payload.model === 'unauthorized') {res.writeHead(401, {'content-type': 'application/json'}); res.end('{"error":{"message":"fake-secret"}}'); return;}
      if (payload.model === 'json' || !payload.stream) {res.writeHead(200, {'content-type': 'application/json'}); res.end(JSON.stringify({choices: [{message: {content: '普通译文'}}]})); return;}
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(frame('流式'));
      const timer = setTimeout(() => res.end(frame('译文') + end), 70);
      res.on('close', () => clearTimeout(timer));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const api = new OpenAI({axios: require('axios'), config: {apiBase: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fake-secret', model: 'stream'}});
    const live = [];
    let finished = false;
    const result = api.translateStream('test', 'en', 'zh-CN', text => {assert(!finished); live.push(text);}).then(value => {finished = true; return value;});
    await wait(40);
    assert.deepEqual(live, ['流式'], 'The real adapter emits partial output before HTTP completion');
    assert.equal((await result).trans.paragraphs[0], '流式译文');
    assert.equal(requests[0].stream, true);
    const abortHTTP = new AbortController();
    await assert.rejects(api.translateStream('cancel', 'en', 'zh-CN', () => abortHTTP.abort(), abortHTTP.signal), error => error.name === 'AbortError');
    api.config.model = 'json';
    assert.equal((await api.translateStream('test', 'en', 'zh-CN', () => {})).trans.paragraphs[0], '普通译文');
    api.config.stream = false; api.config.model = 'stream';
    await api.translateStream('test', 'en', 'zh-CN', () => {throw new Error('Must not emit progress when disabled');});
    assert.equal(requests.at(-1).stream, false);
    api.config.model = 'unauthorized'; api.config.stream = true;
    await assert.rejects(api.translateStream('test', 'en', 'zh-CN', () => {}), error => !String(error).includes('fake-secret'));
  } finally {await new Promise(resolve => server.close(resolve));}

  const state = {}, events = [], copies = [], pendingRequests = [];
  const store = {dispatch: (name, value) => {state[name] = plain(value);}};
  const types = load('src/common/translate/result-types.ts');
  const helper = {notEnglish: language => language !== 'en', normalizeAppend: text => text, autoReSegment: result => ({...result, resultString: result.trans.paragraphs.join('\n')})};
  const engine = {
    getSupportLanguages: () => ['en', 'zh-CN'],
    translateStream: (text, from, to, progress, signal) => new Promise((resolve, reject) => pendingRequests.push({text, progress, signal, resolve: translation => resolve({text, from, to, engine: 'ai', origin: {paragraphs: [text]}, trans: {paragraphs: [translation]}}), reject})),
  };
  const translators = {getTranslator: () => engine, getEnabledWithCustomIds: () => ['ai'], filterExistingEngines: ids => ids, filterByActiveEngines: ids => ids, detectLang: () => 'en'};
  const sharedMocks = {
    './translators': translators, './types': {...types, DirectionalTranslator: class {}}, './chat-stream': streamLib,
    './helper': helper, '../event-bus': {__esModule: true, default: {at: (...args) => events.push(args)}},
    '../configuration': {__esModule: true, default: {get: () => 'ai'}}, '@/store': {__esModule: true, default: store},
    '@/main/tracker': {tracker: {track() {}}},
  };
  const {Compound} = load('src/common/translate/compound.ts', sharedMocks);
  const compound = new Compound(['ai'], 'ai');
  const progress = [];
  const first = compound.translate('one', 'en', 'zh-CN', ['ai'], value => progress.push(plain(value)));
  pendingRequests[0].progress('未完成');
  assert.equal(progress[0].translation, '未完成');
  assert.equal(state.setResultBuffer.ai.status, 'Translating');
  assert.equal(compound.getBuffer('ai'), undefined, 'Partial output must not be served as a completed cache hit');
  const stale = assert.rejects(first, error => error.name === 'AbortError');
  const second = compound.translate('two', 'en', 'zh-CN', ['ai']);
  assert(pendingRequests[0].signal.aborted);
  pendingRequests[0].progress('过期'); pendingRequests[0].resolve('旧译文'); await stale;
  assert.notEqual(state.setResultBuffer.ai.translation, '过期');
  pendingRequests[1].resolve('新译文'); await second;
  assert.equal(compound.getBuffer('ai').translation, '新译文');
  const count = pendingRequests.length;
  await compound.translate('two', 'en', 'zh-CN', ['ai']);
  assert.equal(pendingRequests.length, count, 'Completed results still use the cache');

  // The controller must keep auto-copy/notifications out of progress updates.
  const dependencies = {
    '../common/translate/compound': {Compound}, '../common/dictionary/polymer': {Polymer: class {}},
    '../common/translate/types': types, '../common/rule': {colorRules: [], getColorRule: () => 0},
    '../common/translate/helper': helper, '../common/types': {translatorTypes: ['ai']},
    './simulate': {__esModule: true, default: {}}, '../common/dictionary/types': {emptyDictResult: () => ({valid: false})},
    './clipboard': {clipboard: {writeText: async text => copies.push(text)}}, '@/store': {__esModule: true, default: store},
    './ocr': {}, './pp-ocr': {}, '@/common/event-bus': {__esModule: true, default: {at: (...args) => events.push(args)}},
    '@/common/logger': {__esModule: true, default: {...quiet, toast() {}}}, '@/common/translate/locale': {getLanguageLocales: () => ({en: 'en', 'zh-CN': 'zh-CN'})},
    '@/common/translate/detect-trad': {__esModule: true, default: () => false}, '@/common/configuration': {}, '@/common/translate/token': {},
    '@/common/translate/translators': translators, './proxy-helper': {}, '@/common/translate/proxy': {}, './focus-handler': {},
    '@/common/translate/custom-translators': {}, './tracker': {tracker: {track() {}}},
  };
  const {TranslateController} = load('src/main/translate-controller.ts', dependencies);
  const settings = {autoCopy: true, enableNotify: true, 'translator-enabled': ['ai'], customTranslators: [], sourceLanguage: 'en', targetLanguage: 'zh-CN'};
  const controller = new TranslateController({get: key => settings[key], set() {}});
  const beforeEmpty = pendingRequests.length;
  await controller.translateWithOption({});
  assert.equal(pendingRequests.length, beforeEmpty, 'Selecting an AI engine with an empty input must not send a request');
  controller.translator.mainEngine = 'ai'; controller.text = 'manual input'; controller.language = {source: 'en', target: 'zh-CN'};
  controller.getL = language => language;
  const translating = controller.translateSentence(['ai']);
  pendingRequests.at(-1).progress('正在');
  assert.equal(state.setShared.translation, '正在'); assert.equal(copies.length, 0); assert.equal(events.length, 0);
  pendingRequests.at(-1).resolve('完整译文'); await translating;
  assert.deepEqual(copies, ['完整译文']); assert(events.some(item => item[1] === 'notify'));

  // Native keyboard translation accepts Mac and Windows modifiers, ignores IME
  // confirmation, and does not let progress replace an in-progress text edit.
  const Vue = require('vue'), emptyVue = {__esModule: true, default: Vue.extend({})};
  const base = load('src/components/BaseView.vue', {'./Base.vue': emptyVue, electron: {shell: {}}, '@/common/event-bus': {__esModule: true, default: {}}, '@/common/logger': {__esModule: true, default: quiet}}).default.options;
  let submitted = 0, prevented = 0;
  const key = overrides => ({key: 'Enter', ctrlKey: false, metaKey: false, isComposing: false, preventDefault: () => prevented++, stopPropagation() {}, ...overrides});
  for (const event of [key({metaKey: true}), key({ctrlKey: true}), key({ctrlKey: true, isComposing: true}), key({ctrlKey: true, keyCode: 229}), key({metaKey: true, repeat: true}), key({})]) base.methods.translateKeydown.call({translate: () => submitted++}, event);
  assert.equal(submitted, 2); assert.equal(prevented, 2);
  const panel = load('src/components/ContrastPanel.vue', Object.fromEntries(['BaseView', 'Focus', 'CoTextArea', 'DiffTextArea', 'DictResult'].map(name => [`${name === 'BaseView' ? '../components' : '.'}/${name}.vue`, emptyVue]))).default.options;
  const draft = {sourceText: 'new draft', submittedText: 'old text', status: 'Translating'};
  panel.methods.syncSourceText.call(draft, 'old text'); assert.equal(draft.sourceText, 'new draft');
  panel.methods.syncSourceText.call(draft, ''); assert.equal(draft.sourceText, 'new draft');
  draft.status = 'None'; panel.methods.syncSourceText.call(draft, ''); assert.equal(draft.sourceText, '');
  assert.equal(panel.methods.getModifiedText.call({layoutType: 'focus'}), undefined, 'Only the active input component submits a translation');
  console.log('PASS: SSE/UTF-8 framing, live HTTP progress, cancellation, truncation/errors, JSON compatibility, stream toggle, stale isolation, final-only cache/copy/notifications, keyboard input and IME guards.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
