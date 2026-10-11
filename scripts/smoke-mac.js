// Launch only the supplied build, with a temporary profile and a local mock
// translator. Never reads the user's configuration or sends selected text online.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const net = require('net');
const assert = require('assert').strict;
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const globalMode = process.argv.includes('--global');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const output = path.resolve('node_modules/.cache/selection-smoke');
fs.mkdirSync(output, {recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'copytranslator-smoke-'));
let child, server, log, sourceChild;
const sockets=[];
const errors=[];
async function freePort() { const listener=net.createServer(); await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve)); const port=listener.address().port; await new Promise(resolve=>listener.close(resolve)); return port; }
async function connect(url) {
  const socket=new WebSocket(url); sockets.push(socket);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let seq=0;const pending=new Map();
  socket.addEventListener('message',({data})=>{
    const message=JSON.parse(data);
    if(message.method==='Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if(message.id && pending.has(message.id)) { const p=pending.get(message.id);pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result); }
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;const timer=setTimeout(()=>reject(new Error(`Timeout ${method}`)),10000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});
  await call('Runtime.enable');
  return {call, evaluate:async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}};
}
async function target(port, match) {
  for(let i=0;i<100;i++) {
    if(child.exitCode!==null)throw new Error(`App exited ${child.exitCode}; inspect ${output}/app.log`);
    try { const pages=await(await fetch(`http://127.0.0.1:${port}/json/list`)).json();const page=pages.find(match);if(page)return page; } catch(error) { if(error.message.startsWith('App exited'))throw error; }
    await wait(200);
  }
  throw new Error('Debugger target did not appear');
}
(async()=>{
  server=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const request=JSON.parse(body);const prompt=request.messages.map(message=>message.content).join('\n');
    if(prompt.includes('FAIL_TEST')){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'Controlled test failure'}}));return;}
    await wait(prompt.includes('SLOW_TEST')?650:30);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:prompt.includes('LATEST_TEST')?'最新选择的译文。':'选中文字后，翻译结果会显示在鼠标附近的小窗中。'}}]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  fs.writeFileSync(path.join(profile,'copytranslator.json'),JSON.stringify({
    version:'v12.1.0 知微',listenClipboard:false,enableOCR:false,dragCopy:false,selectionPopup:!globalMode,autoCheckUpdate:false,isNewUser:false,stayTop:false,autoCopy:false,autoPaste:false,openAtLogin:false,localeSetting:'zh-CN',
    translatorType:'smoke-test',sourceLanguage:'en',targetLanguage:'zh-CN',smartTranslate:false,
    translatorProviders:[{id:'smoke',name:'本地测试',providerType:'custom',apiBase:`http://127.0.0.1:${server.address().port}/v1`,apiKey:'test-only',enabledModels:['test'],enabled:true}],
    'translator-enabled':['smoke-test'],autoShow:false
  }));
  const port=await freePort(), mainPort=await freePort();
  const binary=path.resolve(process.argv.slice(2).find(arg=>!arg.startsWith('--'))||'dist_electron/mac-arm64/copytranslator.app/Contents/MacOS/copytranslator');
  log=fs.createWriteStream(path.join(output,'app.log'));
  child=spawn(binary,[`--remote-debugging-port=${port}`,`--inspect=127.0.0.1:${mainPort}`],{env:{...process.env,COPYTRANSLATOR_CONFIG_DIR:profile,COPYTRANSLATOR_DISABLE_GLOBAL_HOOKS:globalMode?"0":"1"},stdio:['ignore','pipe','pipe']});child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
  const main=await connect((await target(mainPort,p=>p.type==='node')).webSocketDebuggerUrl);
  const page=await connect((await target(port,p=>p.type==='page' && !p.url.includes('selection-popup'))).webSocketDebuggerUrl);
  for(let i=0;i<50;i++){if(await page.evaluate('document.querySelectorAll("button").length')>5)break;await wait(200);}
  assert((await page.evaluate('document.querySelectorAll("button").length'))>5,'Main UI renders');
  assert.equal(await main.evaluate('process.arch'),'arm64');
  assert.equal(await main.evaluate('global.controller.get("translatorType")'),'smoke-test');
  if (globalMode) {
    const fixture = path.join(output, 'selection-source');
    const compiled = spawnSync('xcrun', ['swiftc', 'tests/native/SelectionSource.swift', '-o', fixture], {stdio:'inherit'});
    assert.equal(compiled.status, 0);
    await main.evaluate('global.controller.win.mainWindow.hide()');
    sourceChild = spawn(fixture, [], {stdio:['pipe','pipe','inherit']});
    const lines = readline.createInterface({input:sourceChild.stdout});
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Fixture did not start')),5000);lines.once('line',line=>{clearTimeout(timer);assert(JSON.parse(line).ready);resolve();});});
    await main.evaluate('global.controller.set("selectionPopup",true)');
    await wait(300);
    sourceChild.stdin.write('gesture\n');
    const popup = await connect((await target(port,p=>p.url.includes('selection-popup/index.html'))).webSocketDebuggerUrl);
    let state;
    for(let i=0;i<80;i++){state=await popup.evaluate('window.selectionPopup.state()');if(state.status==='done')break;await wait(50);}
    await main.evaluate('global.controller.set("selectionPopup",false)');
    assert.equal(state.status,'done',state.error);
    assert(state.text.startsWith('Selection translation'),state.text);
    sourceChild.stdin.write('quit\n');
    const result={globalSelectionToPopup:true,source:'isolated NSTextView',translation:'local mock',errors};
    fs.writeFileSync(path.join(output,'global-result.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    return;
  }
  await main.evaluate('global.controller.selectionPopup.show("Select text in any application to see its translation nearby.",{x:500,y:300})');
  const popup=await connect((await target(port,p=>p.url.includes('selection-popup/index.html'))).webSocketDebuggerUrl);
  async function state(){return popup.evaluate('window.selectionPopup.state()');}
  async function done(){for(let i=0;i<80;i++){const s=await state();if(s.status!=='loading')return s;await wait(50);}throw new Error('Translation timeout');}
  const translated=await done();assert.equal(translated.status,'done',translated.error);
  assert(translated.translation.includes('鼠标附近'));
  assert(translated.text.includes('Select text'), 'Use only the synthetic test selection');
  const screenshot=await popup.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'popup.png'),Buffer.from(screenshot.data,'base64'));
  assert.equal(await popup.evaluate('typeof require'),'undefined','Popup is sandboxed');
  const rejected=await page.evaluate('require("electron").ipcRenderer.invoke("selection-popup:state")');assert.equal(rejected,null,'Other renderer cannot read selection');
  await main.evaluate('global.controller.selectionPopup.show("SLOW_TEST",{x:500,y:300})');await wait(200);
  await main.evaluate('global.controller.selectionPopup.show("LATEST_TEST",{x:500,y:300})');await done();await wait(700);assert.equal((await state()).translation,'最新选择的译文。');
  await main.evaluate('global.controller.selectionPopup.show("FAIL_TEST",{x:500,y:300})');assert.equal((await done()).status,'error');
  await popup.evaluate('window.selectionPopup.action("pin")');assert.equal((await state()).pinned,true);
  await popup.evaluate('window.selectionPopup.action("close")');assert.equal((await state()).text,'');
  await main.evaluate('global.controller.handle("settings", "switches")');
  const settings=await connect((await target(port,p=>p.url.includes('settings'))).webSocketDebuggerUrl);await wait(600);
  assert((await settings.evaluate('document.body.innerText')).includes('全局划词浮窗'),'Settings expose the new switch');
  assert.equal(errors.length,0,JSON.stringify(errors));
  const result={architecture:'arm64',mainUI:true,settings:true,popup:true,sandbox:true,ipcIsolation:true,translation:true,staleReply:true,errorState:true,pinAndClose:true,errors};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  sockets.forEach(socket=>socket.close());
  if(sourceChild)sourceChild.stdin.end();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await wait(600);if(child.exitCode===null)child.kill('SIGKILL');}
  if(server)server.close();if(log)log.end();
  fs.rmSync(profile,{recursive:true,force:true});
});
