const assert = require('assert').strict;
const fs = require('fs'), vm = require('vm'), ts = require('typescript'), http = require('http');
const mocks = {};
function load(file, extra = {}) {
  const module = {exports:{}};
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code, {module,exports:module.exports,require:id=>extra[id] || mocks[id] || require(id),URL,Buffer,AbortController,Error,setTimeout,clearTimeout,console}, {filename:file});
  return module.exports;
}
const plain = value => JSON.parse(JSON.stringify(value));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (const name of ['chat-settings','provider-http','chat-stream','chat-request','context-chat']) {
  const module = load(`src/common/translate/${name}.ts`);
  mocks['./'+name] = module; mocks['@/common/translate/'+name] = module;
}
const {buildContextChatMessages} = mocks['./context-chat'];
(async () => {
  const history = [{role:'user',content:'Question one',status:'done'},{role:'assistant',content:'Completed answer',status:'done'},
    {role:'user',content:'Cancelled question',status:'done'},{role:'assistant',content:'partial',status:'stopped'}];
  const messages = plain(buildContextChatMessages('Source {text}',history,'Follow up','Explain carefully.'));
  assert.equal(messages[0].content,'Explain carefully.');
  assert(messages[1].content.includes('Source {text}'), 'Attach source literally, without prompt substitution');
  assert.deepEqual(messages.slice(2),[{role:'user',content:'Question one'},{role:'assistant',content:'Completed answer'},{role:'user',content:'Follow up'}]);
  assert.throws(()=>buildContextChatMessages('',[],'Question'));
  assert.throws(()=>buildContextChatMessages('x'.repeat(20001),[],'Question'));
  assert.throws(()=>buildContextChatMessages('Source',[],'x'.repeat(4001)));
  assert.throws(()=>buildContextChatMessages('Source',Array(20).fill(history.slice(0,2)).flat(),'Question'));
  const bodies = [], timings = [];
  const server = http.createServer(async (req,res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const payload = JSON.parse(body); bodies.push(payload);
    if (!payload.stream) {res.setHeader('content-type','application/json'); res.end(JSON.stringify({choices:[{message:{content:'Complete answer'}}]})); return;}
    res.writeHead(200, {'content-type':'text/event-stream'});
    res.write('data: '+JSON.stringify({choices:[{delta:{content:'First '}}]})+'\n\n');
    await wait(90);
    res.end('data: '+JSON.stringify({choices:[{delta:{content:'answer'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const model = {id:'provider-model',name:'Reading model',config:{apiBase:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'fake-local-key',model:'model',prompt:'TRANSLATION ONLY {text}',chatPrompt:'Read and explain.',chatEnabled:true,stream:true,providerType:'deepseek',reasoningEffort:'none'}};
  const manager = {getAllIds:()=>['provider-model'],getConfig:id=>id===model.id?model:undefined};
  const service = load('src/main/selection-chat.ts', {
    '@/common/translate/custom-translators':{customTranslatorManager:manager},
    '@/common/translate/proxy':{axios:require('axios')},
  });
  try {
    assert.deepEqual(plain(service.selectionChatModels()),[{id:'provider-model',name:'Reading model',ai:true}]);
    const started = Date.now();
    const answer = await service.requestSelectionChat(model.id,'Source passage',history,'Explain?',text=>timings.push({text,at:Date.now()-started}),new AbortController().signal);
    assert.equal(answer,'First answer'); assert.equal(timings[0].text,'First ');
    assert(timings.at(-1).at - timings[0].at >= 60, 'Real HTTP deltas arrive before completion');
    assert.equal(bodies[0].messages[0].content,'Read and explain.');
    assert(bodies[0].messages[1].content.includes('Source passage'));
    assert(!JSON.stringify(bodies[0].messages).includes('TRANSLATION ONLY'));
    assert(!JSON.stringify(bodies[0].messages).includes('Cancelled question'));
    assert.equal(bodies[0].thinking.type,'disabled'); assert.equal(bodies[0].model,'model');
    model.config.stream = false;
    assert.equal(await service.requestSelectionChat(model.id,'Source passage',[],'Explain?',()=>{},new AbortController().signal),'Complete answer');
    assert.equal(bodies.at(-1).stream,false);
    model.config.stream = true;
    const cancelled = new AbortController();
    await assert.rejects(service.requestSelectionChat(model.id,'Source passage',[],'Explain?',()=>cancelled.abort(),cancelled.signal),error=>error.name==='AbortError');
    model.config.chatEnabled = false;
    assert.equal(service.selectionChatModels().length,0);
    await assert.rejects(service.requestSelectionChat(model.id,'Source',[],'Question',()=>{},new AbortController().signal));
    await assert.rejects(service.requestSelectionChat('unknown','Source',[],'Question',()=>{},new AbortController().signal));
  } finally { server.closeAllConnections?.(); await new Promise(resolve=>server.close(resolve)); }
  console.log('PASS: source attachment, completed-turn history, separate chat prompt, limits, model enablement, live HTTP streaming, reasoning settings, non-stream response and cancellation.');
})().catch(error=>{console.error(error);process.exitCode=1;});
