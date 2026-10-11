const assert = require('assert').strict;
const fs = require('fs'), ts = require('typescript'), vm = require('vm');
function load(file, mocks = {}) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module,exports:module.exports,require:id=>mocks[id] || require(id),process,console});
  return module.exports;
}
const {BaiduCompatible} = load('src/common/translate/baidu-compatible.ts');
(async () => {
  let calls = [], data = {from:'jp',trans_result:[{src:'こんにちは',dst:'你好'}]};
  const axios = async (url, options) => { calls.push({url,...options}); return {data}; };
  const translator = new BaiduCompatible({axios,config:{legacyClientId:'test-client'}});
  const result = await translator.translate('こんにちは','ja','zh-CN');
  assert.equal(calls[0].url,'https://openapi.baidu.com/public/2.0/bmt/translate');
  assert.equal(calls[0].params.from,'jp'); assert.equal(result.from,'ja'); assert.equal(result.engine,'baidu');
  assert.equal(result.trans.paragraphs[0],'你好'); assert(result.trans.tts);
  await translator.translate('hello','en','zh-CN',{appid:'user-id',key:'user-key'});
  assert.equal(calls[1].url,'https://api.fanyi.baidu.com/api/trans/vip/translate');
  assert.equal(calls[1].params.appid,'user-id'); assert(!('client_id' in calls[1].params));
  await assert.rejects(translator.translate('hello','en','zh-CN',{appid:'incomplete'}),/完整填写/);
  assert.equal(calls.length,2,'Invalid partial credentials must not trigger a request');
  await assert.rejects(new BaiduCompatible({axios}).translate('hello','en','zh-CN'),/未包含百度兼容配置/);
  data={error_code:'52003',error_msg:'untrusted provider text'};
  await assert.rejects(translator.translate('hello','en','zh-CN'),/百度认证失败（52003）/);
  data={error_code:54004}; await assert.rejects(translator.translate('hello','en','zh-CN'),/额度或频率受限/);
  data={trans_result:[]}; await assert.rejects(translator.translate('hello','en','zh-CN'),/有效译文/);
  const failed = new BaiduCompatible({axios:async()=>{throw new Error('URL containing credentials');},config:{legacyClientId:'test-client'}});
  await assert.rejects(failed.translate('hello','en','zh-CN'),error=>error.message.includes('连接百度') && !error.message.includes('credentials'));

  let saved={appid:'',key:''};
  const module = load('src/common/translate/translators.ts', {
    './token':{defaultTokens:new Map([['baidu',{legacyClientId:'build-client'}]])},
    './proxy':{axios}, '../configuration':{__esModule:true,default:{has:()=>true,get:()=>saved}},
    './custom-translators':{customTranslatorManager:{}}, './baidu-compatible':{BaiduCompatible},
  });
  assert.equal(module.getTranslator('baidu').config.legacyClientId,'build-client','Empty saved configuration preserves bundled compatibility');
  saved={appid:'user-id',key:'user-key'}; module.translators.delete('baidu');
  assert.equal(module.getTranslator('baidu').config.appid,'user-id');
  saved={appid:'',key:''}; module.translators.delete('baidu');
  assert.equal(module.getTranslator('baidu').config.legacyClientId,'build-client','Clearing user credentials restores compatibility');
  console.log('PASS: Baidu route selection, user credential priority, empty-config migration, language normalization, actionable/sanitized errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
