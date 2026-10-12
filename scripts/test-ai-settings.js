const assert = require('assert').strict;
const fs = require('fs'), vm = require('vm'), ts = require('typescript');
const axios = require('axios');
const modules = {};
function load(name, mocks = {}) {
  const file = 'src/common/translate/' + name + '.ts';
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, esModuleInterop: true}}).outputText;
  const module = {exports: {}};
  vm.runInNewContext(code, {module, exports: module.exports, require: id => mocks[id] || modules[id] || require(id), URL, Buffer, AbortController, Error, setTimeout, clearTimeout}, {filename: file});
  modules['./' + name] = module.exports;
  return module.exports;
}
const settings = load('chat-settings');
load('provider-http'); load('chat-stream');
const {requestChatCompletion} = load('chat-request');
load('provider-config');
const {testProviderConnection} = load('provider-connection', {'./proxy': {axios}});
const plain = value => JSON.parse(JSON.stringify(value));
const frame = delta => `data: ${JSON.stringify({choices: [{index: 0, delta}]})}\n\n`;
const complete = JSON.stringify({choices: [{message: {content: '普通译文'}, finish_reason: 'stop'}]});

async function run() {
  for (const empty of ['', 'default', undefined, '  ']) assert.equal(settings.effectivePrompt(empty), settings.DEFAULT_TRANSLATION_PROMPT);
  assert.equal(settings.effectivePrompt('custom {text}'), 'custom {text}');
  const build = (providerType, reasoningEffort, rest = {}) => settings.buildChatRequest({providerType, reasoningEffort, model: 'test', maxTokens: 800, temperature: 0, ...rest}, [], true);
  for (const provider of ['deepseek', 'openai', 'custom']) {
    const request = build(provider, 'default');
    assert(!('thinking' in request)); assert(!('reasoning_effort' in request));
  }
  assert.deepEqual(plain(build('deepseek', 'none').thinking), {type: 'disabled'});
  for (const effort of ['low', 'high', 'max']) {
    const request = build('deepseek', effort);
    assert.equal(request.thinking.type, 'enabled'); assert.equal(request.reasoning_effort, effort);
    assert(!('temperature' in request));
  }
  assert.throws(() => build('deepseek', 'medium'), /不支持/);
  assert.throws(() => build('custom', 'high'), /不支持/);
  assert.equal(build('custom', 'low', {reasoningProtocol: 'deepseek'}).thinking.type, 'enabled');
  assert.equal(build('custom', 'none', {apiBase: 'https://api.deepseek.com/v1'}).thinking.type, 'disabled');
  assert(!settings.reasoningProtocol('custom', 'https://api.deepseek.com.fake.test'));
  for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
    const request = build('openai', effort);
    assert.equal(request.reasoning_effort, effort); assert.equal(request.max_completion_tokens, 800);
    assert(!('thinking' in request)); assert(!('max_tokens' in request)); assert(!('temperature' in request));
  }
  assert.equal(build('openai', 'default', {model: 'o3'}).max_completion_tokens, 800);

  const calls = [];
  const server = require('http').createServer((req, res) => {
    let input = '';
    req.on('data', chunk => input += chunk);
    req.on('end', () => {
      const body = JSON.parse(input); calls.push(body);
      const json = (status, value) => {res.writeHead(status, {'content-type': 'application/json'}); res.end(typeof value === 'string' ? value : JSON.stringify(value));};
      if (body.model === 'unsupported' && body.stream) return json(400, {error: {param: 'stream', code: 'unsupported_parameter', message: 'Streaming is not supported'}});
      if (body.model === 'rejected-reasoning') return json(422, {error: {param: 'reasoning_effort', message: 'Thinking not supported; secret-key'}});
      if (body.model === 'unrelated') return json(400, {error: {param: 'temperature', message: 'Unsupported temperature. Stream request could not complete; secret-key'}});
      if (body.model === 'invalid-key') return json(401, {error: {param: 'stream', message: 'Streaming is not supported; secret-key'}});
      if (body.model === 'rate-limit') return json(429, {error: {message: 'Streaming not supported; secret-key'}});
      if (!body.stream || body.model === 'json') return json(200, complete);
      res.writeHead(200, {'content-type': 'text/event-stream'});
      res.write(frame({reasoning_content: 'hidden reasoning'}));
      const first = setTimeout(() => res.write(frame({content: '分段'})), 20);
      const last = setTimeout(() => res.end(frame({content: '译文'}) + (body.model === 'truncated' ? '' : 'data: [DONE]\n\n')), 110);
      res.on('close', () => {clearTimeout(first); clearTimeout(last);});
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const apiBase = `http://127.0.0.1:${server.address().port}/v1`;
  const base = {apiBase, apiKey: 'secret-key', providerType: 'deepseek', reasoningEffort: 'none', onProgress: () => {}};
  try {
    const updates = [];
    const pending = requestChatCompletion(axios, {...base, model: 'stream', onProgress: text => updates.push(text)}, []);
    await new Promise(resolve => setTimeout(resolve, 65));
    assert.deepEqual(updates, ['分段'], 'The real shared adapter must publish before response completion');
    const streamed = await pending;
    assert.equal(streamed.responseMode, 'sse'); assert.equal(streamed.contentDeltas, 2); assert.equal(streamed.reasoningDeltas, 1);
    assert(streamed.firstReasoningMs < streamed.firstContentMs); assert(streamed.firstContentMs < streamed.elapsedMs);
    assert.deepEqual(updates, ['分段', '分段译文']);
    const before = calls.length;
    const fallback = await requestChatCompletion(axios, {...base, model: 'unsupported'}, []);
    assert.equal(fallback.responseMode, 'fallback'); assert.equal(fallback.text, '普通译文');
    assert.equal(calls.length - before, 2);
    assert.equal(calls.at(-2).stream, true); assert.equal(calls.at(-1).stream, false);
    assert.deepEqual(calls.at(-1).thinking, {type: 'disabled'}, 'Fallback must preserve explicit thinking preferences');
    const json = await requestChatCompletion(axios, {...base, model: 'json'}, []);
    assert.equal(json.responseMode, 'json'); assert.equal(json.contentDeltas, 0);
    for (const model of ['rejected-reasoning', 'unrelated', 'invalid-key', 'rate-limit', 'truncated']) {
      const count = calls.length;
      await assert.rejects(requestChatCompletion(axios, {...base, model}, []), error => !error.message.includes('secret-key'));
      assert.equal(calls.length - count, 1, `${model} must not trigger a fallback/retry`);
    }
    const abort = new AbortController();
    await assert.rejects(requestChatCompletion(axios, {...base, model: 'stream', signal: abort.signal, onProgress: () => abort.abort()}, []), error => error.name === 'AbortError');
    const provider = {apiBase, apiKey: 'secret-key', providerType: 'deepseek', config: {stream: true, reasoningEffort: 'low', prompt: 'CUSTOM {from} {to}: {text}', maxTokens: 500}};
    const tested = await testProviderConnection(provider, 'stream');
    assert.equal(tested.responseMode, 'sse'); assert.equal(tested.contentDeltas, 2);
    assert(tested.firstContentMs < tested.elapsedMs);
    assert.equal(calls.at(-1).reasoning_effort, 'low'); assert.equal(calls.at(-1).max_tokens, 500);
    assert(calls.at(-1).messages[0].content.startsWith('CUSTOM English Simplified Chinese: A quiet library'));
    provider.config.stream = false; provider.config.reasoningEffort = 'none';
    const unstreamed = await testProviderConnection(provider, 'stream');
    assert.equal(unstreamed.requestedStream, false); assert.equal(unstreamed.responseMode, 'json');
    assert.equal(calls.at(-1).stream, false); assert.equal(calls.at(-1).thinking.type, 'disabled');
  } finally {await new Promise(resolve => server.close(resolve));}
  console.log('PASS: default/custom prompts, vendor-specific thinking payloads, actual stream timings, conservative stream fallback, preserved reasoning options, no retry on auth/rate/parameter/truncation errors, and connection tests use current settings.');
}
run().catch(error => {console.error(error); process.exitCode = 1;});
