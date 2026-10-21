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
const nativeInput = process.argv.includes('--native-input');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function eventually(check, description) {
  for (let i=0;i<60;i++) { if (await check()) return; await wait(50); }
  throw new Error(`Timed out: ${description}`);
}
const output = path.resolve('node_modules/.cache/selection-smoke');
fs.mkdirSync(output, {recursive:true});
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'copytranslator-smoke-'));
let child, server, log, sourceChild, spaceChild;
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
  await main.evaluate('global.testElectron=process.getBuiltinModule("module").createRequire(process.execPath)("electron"); global.controller.win.mainWindow.show()');
  await wait(700);
  const originalTheme = await main.evaluate('global.testElectron.nativeTheme.themeSource');
  const dark = () => page.evaluate('document.querySelector(".v-application").classList.contains("theme--dark")');
  await main.evaluate('global.controller.set("colorMode","auto"); global.testElectron.nativeTheme.themeSource="dark"');
  await eventually(dark,'Auto follows a live change to dark');
  await main.evaluate('global.testElectron.nativeTheme.themeSource="light"');
  await eventually(async()=>!(await dark()),'Auto follows a live change to light');
  await main.evaluate('global.controller.set("colorMode","dark")');
  await eventually(dark,'Explicit dark setting');
  await main.evaluate('global.testElectron.nativeTheme.themeSource="dark"'); await wait(100);
  await main.evaluate('global.testElectron.nativeTheme.themeSource="light"'); await wait(100);
  assert(await dark(),'An explicit dark setting is not overwritten by the system');
  await main.evaluate('global.controller.set("colorMode","light"); global.testElectron.nativeTheme.themeSource="dark"');
  await eventually(async()=>!(await dark()),'Explicit light setting remains light');
  // Let Chromium deliver the media event before the next OS appearance change.
  await page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await main.evaluate(`global.controller.set("colorMode","auto"); global.testElectron.nativeTheme.themeSource=${JSON.stringify(originalTheme)}`);
  await eventually(async()=>(await dark())===await main.evaluate('global.testElectron.nativeTheme.shouldUseDarkColors'),'Restored system appearance');
  await main.evaluate('global.controller.selectionPopup.show("Select text in any application to see its translation nearby.",{x:500,y:300})');
  const popupTarget=await target(port,p=>p.url.includes('selection-popup/index.html'));
  const popup=await connect(popupTarget.webSocketDebuggerUrl);
  async function state(){return popup.evaluate('window.selectionPopup.state()');}
  async function done(expectedText){for(let i=0;i<80;i++){const s=await state();if((!expectedText || s.text===expectedText) && s.status!=='loading')return s;await wait(50);}throw new Error('Translation timeout: '+JSON.stringify({expectedText,state:await state(),sessions:await main.evaluate('global.controller.selectionPopup.sessions.map(s=>({text:s.state.text,pinned:s.state.pinned,current:s.onCurrentSpace(),visible:s.wantsVisible,allSpaces:s.window?.isVisibleOnAllWorkspaces()}))')}));}
  const translated=await done();assert.equal(translated.status,'done',translated.error);
  assert(translated.translation.includes('鼠标附近'));
  assert(translated.text.includes('Select text'), 'Use only the synthetic test selection');
  const screenshot=await popup.call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(output,'popup.png'),Buffer.from(screenshot.data,'base64'));
  const bounds=()=>main.evaluate('global.controller.selectionPopup.current.window.getBounds()');
  for (const [preset,width,height] of [['small',450,360],['medium',600,480],['large',780,640]]) {
    await popup.evaluate(`document.querySelector('[data-size="${preset}"]').click()`);
    await eventually(async()=>(await bounds()).width===width && (await bounds()).height===height,`${preset} preset`);
    await wait(100);
    assert.equal(await popup.evaluate(`document.querySelector('.size-presets [aria-pressed="true"]').dataset.size`),preset);
    const shot=await popup.call('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(output,`popup-${preset}.png`),Buffer.from(shot.data,'base64'));
  }
  await popup.evaluate('window.selectionPopup.action("size-preset","small")');
  await popup.evaluate('window.selectionPopup.action("pin")');
  const screenArea=await main.evaluate('global.testElectron.screen.getPrimaryDisplay().workArea');
  if (nativeInput) {
  const pointerBinary=path.join(output,'pointer-gesture');
  assert.equal(spawnSync('xcrun',['swiftc','tests/native/PointerGesture.swift','-o',pointerBinary],{stdio:'inherit'}).status,0);
  for (const edge of ['n','ne','e','se','s','sw','w','nw']) {
    const original={x:screenArea.x+100,y:screenArea.y+100,width:450,height:360};
    await main.evaluate(`global.controller.selectionPopup.current.window.setBounds(${JSON.stringify(original)}); global.controller.selectionPopup.current.window.focus()`); await wait(70);
    const point=await popup.evaluate(`(()=>{const e=document.querySelector('[data-resize="${edge}"]'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===e,cursor:getComputedStyle(e).cursor};})()`);
    assert(point.hit,`${edge} is hittable above the content`); assert(point.cursor.endsWith('resize'));
    const start={x:original.x+point.x,y:original.y+point.y};
    assert.equal(spawnSync(pointerBinary,[start.x,start.y,start.x+20,start.y+20].map(String),{stdio:'inherit'}).status,0);
    const expected={x:original.x+(edge.includes('w')?20:0),y:original.y+(edge.includes('n')?20:0),width:450+(edge.includes('e')?20:edge.includes('w')?-20:0),height:360+(edge.includes('s')?20:edge.includes('n')?-20:0)};
    try { await eventually(async()=>JSON.stringify(await bounds())===JSON.stringify(expected),`${edge} resizes with the opposite edge fixed`); } catch (error) { console.log(JSON.stringify({edge,expected,actual:await bounds(),resize:await main.evaluate('global.controller.selectionPopup.current.resize'),visible:await popup.evaluate('document.visibilityState'),errors})); throw error; }
    await wait(50);
  }
  }
  await popup.evaluate('window.selectionPopup.action("size-preset","small")');
  assert.equal(await main.evaluate('global.controller.selectionPopup.current.window.isVisibleOnAllWorkspaces()'),false,'Native panel is bound to one Space');
  assert.equal(await main.evaluate('global.controller.selectionPopup.current.window.isHiddenInMissionControl()'),false,'Results participate in Mission Control');
  await main.evaluate('global.controller.selectionPopup.workspaceChanged()');
  assert(await main.evaluate('global.controller.selectionPopup.current.window.isVisible()'),'Pinned survives a workspace event');
  await popup.evaluate('window.selectionPopup.action("pin")');
  await main.evaluate('global.controller.selectionPopup.workspaceChanged()');
  assert.equal(await main.evaluate('global.controller.selectionPopup.current.window.isVisible()'),true,'Unpinned result stays in its Space');
  assert.equal(await popup.evaluate('typeof require'),'undefined','Popup is sandboxed');
  const rejected=await page.evaluate('require("electron").ipcRenderer.invoke("selection-popup:state")');assert.equal(rejected,null,'Other renderer cannot read selection');
  await main.evaluate('global.controller.selectionPopup.show("SLOW_TEST",{x:500,y:300})');await wait(200);
  await main.evaluate('global.controller.selectionPopup.show("LATEST_TEST",{x:500,y:300})');await done('LATEST_TEST');await wait(700);assert.equal((await state()).translation,'最新选择的译文。');
  await main.evaluate('global.controller.selectionPopup.show("FAIL_TEST",{x:500,y:300})');assert.equal((await done('FAIL_TEST')).status,'error');
  await popup.evaluate('window.selectionPopup.action("pin")');assert.equal((await state()).pinned,true);
  const original=await state();
  await main.evaluate('global.controller.selectionPopup.show("Comparison B",{x:500,y:300})');
  const comparison=await connect((await target(port,p=>p.url.includes('selection-popup') && p.id!==popupTarget.id)).webSocketDebuggerUrl);
  await eventually(async()=>(await comparison.evaluate('window.selectionPopup.state()')).status==='done','Independent comparison translation');
  assert.equal((await state()).text,original.text); assert.equal((await state()).status,original.status);
  assert.equal((await comparison.evaluate('window.selectionPopup.state()')).text,'Comparison B');
  await comparison.evaluate('window.selectionPopup.action("close")');
  assert.equal((await state()).text,original.text,'Closing comparison leaves the first window intact');
  await popup.evaluate('window.selectionPopup.action("close")');assert.equal((await state()).text,'');
  await main.evaluate('global.controller.handle("settings", "switches")');
  const settings=await connect((await target(port,p=>p.url.includes('settings'))).webSocketDebuggerUrl);await wait(600);
  assert((await settings.evaluate('document.body.innerText')).includes('全局划词浮窗'),'Settings expose the new switch');
  // Observe real macOS Space notifications using the shipped helper, with
  // clipboard and selection monitoring left disabled. A temporary test window
  // enters and leaves fullscreen, returning to the original desktop afterwards.
  let spaceEvents=0;
  spaceChild=spawn(path.resolve(path.dirname(binary),'../Resources/native/selection-helper'),[String(child.pid)],{stdio:['pipe','pipe','pipe']});
  const spaceLines=readline.createInterface({input:spaceChild.stdout});
  let helperReady=false;
  spaceLines.on('line',line=>{try{const message=JSON.parse(line);if(message.event==='ready')helperReady=true;if(message.event==='space-changed')spaceEvents++;}catch{}});
  await eventually(async()=>helperReady,'Native workspace helper starts');
  await main.evaluate('global.spaceTestWindow=new global.testElectron.BrowserWindow({width:620,height:400,fullscreenable:true,title:"CopyTranslator 桌面切换测试",webPreferences:{sandbox:true}});global.spaceTestWindow.loadURL("data:text/html;charset=utf-8,<p>CopyTranslator 正在检查桌面切换，测试后自动关闭。</p>")');
  await wait(300);
  await main.evaluate('global.controller.selectionPopup.show("Desktop retained",{x:500,y:300}); global.desktopPopup=global.controller.selectionPopup.current; undefined');
  await eventually(async()=>await main.evaluate('global.desktopPopup.state.status')==='done','Desktop result is ready');
  assert(await main.evaluate('global.desktopPopup.onCurrentSpace()'));
  let previousSpaceEvents=spaceEvents;
  await main.evaluate('global.spaceTestWindow.setFullScreen(true)');
  await eventually(async()=>spaceEvents>previousSpaceEvents && await main.evaluate('global.spaceTestWindow.isFullScreen()'),'Native notification on entering a fullscreen Space');
  await wait(500);
  assert.equal(await main.evaluate('global.desktopPopup.onCurrentSpace()'),false,'Original result stays off the new Space');
  await main.evaluate('global.controller.selectionPopup.workspaceChanged(); global.controller.selectionPopup.pointerDown({x:0,y:0}); global.controller.selectionPopup.show("Fullscreen retained",{x:500,y:300}); global.fullscreenPopup=global.controller.selectionPopup.current; undefined');
  await eventually(async()=>await main.evaluate('global.fullscreenPopup.state.status')==='done','Fullscreen result is ready');
  assert(await main.evaluate('global.fullscreenPopup!==global.desktopPopup && global.fullscreenPopup.onCurrentSpace()'),'New popup appears in the fullscreen Space');
  assert.equal(await main.evaluate('global.fullscreenPopup.window.isVisibleOnAllWorkspaces()'),false);
  assert.equal(await main.evaluate('global.desktopPopup.state.text'),'Desktop retained','Off-Space clicks and requests leave the original untouched');
  previousSpaceEvents=spaceEvents;
  await main.evaluate('global.spaceTestWindow.setFullScreen(false)');
  await eventually(async()=>spaceEvents>previousSpaceEvents && !(await main.evaluate('global.spaceTestWindow.isFullScreen()')),'Native notification on returning to the desktop');
  await eventually(async()=>await main.evaluate('global.desktopPopup.onCurrentSpace()'),'Original Space becomes active again');
  assert(await main.evaluate('global.desktopPopup.wantsVisible && global.desktopPopup.window.isVisible()'),'Unpinned result is still visible on return');
  assert.equal(await main.evaluate('global.desktopPopup.state.text'),'Desktop retained');
  await main.evaluate('global.spaceTestWindow.destroy()');
  const foreignBinary=path.join(output,'popup-space-source');
  assert.equal(spawnSync('xcrun',['swiftc','tests/native/PopupSpaceSource.swift','-o',foreignBinary],{stdio:'inherit'}).status,0);
  sourceChild=spawn(foreignBinary,[],{stdio:['pipe','pipe','inherit']});
  const foreignLines=readline.createInterface({input:sourceChild.stdout});
  let foreignReady=false, foreignFullscreen=false;
  foreignLines.on('line',line=>{const message=JSON.parse(line);if(message.ready)foreignReady=true;if('fullscreen' in message)foreignFullscreen=message.fullscreen;});
  await eventually(async()=>foreignReady,'Independent native app starts');
  previousSpaceEvents=spaceEvents; sourceChild.stdin.write('fullscreen\n');
  await eventually(async()=>foreignFullscreen && spaceEvents>previousSpaceEvents,'Independent app enters fullscreen');
  await wait(500);
  await main.evaluate('global.controller.selectionPopup.workspaceChanged(); global.controller.selectionPopup.show("Foreign fullscreen retained",{x:500,y:300}); global.foreignPopup=global.controller.selectionPopup.current; undefined');
  await eventually(async()=>await main.evaluate('global.foreignPopup.state.status')==='done','Translation in another app fullscreen');
  assert(await main.evaluate('global.foreignPopup.onCurrentSpace() && global.foreignPopup.window.isVisible()'),'Panel is visible in another app fullscreen Space');
  assert.equal(await main.evaluate('global.foreignPopup.window.isVisibleOnAllWorkspaces()'),false,'Foreign fullscreen result is not an all-Spaces overlay');
  previousSpaceEvents=spaceEvents; sourceChild.stdin.write('windowed\n');
  await eventually(async()=>!foreignFullscreen && spaceEvents>previousSpaceEvents,'Independent app returns to desktop');
  await eventually(async()=>await main.evaluate('global.desktopPopup.onCurrentSpace()'),'Return to the original desktop from another app');
  assert.equal(await main.evaluate('global.desktopPopup.state.text'),'Desktop retained');
  sourceChild.stdin.write('quit\n'); foreignLines.close();
  spaceChild.stdin.end(); spaceLines.close();
  assert.equal(errors.length,0,JSON.stringify(errors));
  const result={architecture:'arm64',mainUI:true,settings:true,popup:true,liveSystemTheme:true,explicitThemeOverrides:true,eightResizeHandles:nativeInput,sizePresets:true,workspaceRetention:true,nativeSpaceBinding:true,fullscreenResult:true,foreignFullscreenResult:true,desktopRoundTrip:true,independentComparisons:true,nativeSpaceNotifications:true,sandbox:true,ipcIsolation:true,translation:true,staleReply:true,errorState:true,pinAndClose:true,errors};
  fs.writeFileSync(path.join(output,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  sockets.forEach(socket=>socket.close());
  if(sourceChild)sourceChild.stdin.end();
  if(spaceChild)spaceChild.stdin.end();
  if(child&&child.exitCode===null){child.kill('SIGTERM');await wait(600);if(child.exitCode===null)child.kill('SIGKILL');}
  if(server)server.close();if(log)log.end();
  fs.rmSync(profile,{recursive:true,force:true});
});
