const {spawn,spawnSync}=require('child_process');
const fs=require('fs');const path=require('path');const readline=require('readline');const assert=require('assert').strict;
if(process.platform!=='darwin')throw new Error('macOS only');
const cache=path.resolve('node_modules/.cache/selection-smoke');fs.mkdirSync(cache,{recursive:true});
const binary=path.join(cache,'selection-source');
const compiled=spawnSync('xcrun',['swiftc','tests/native/SelectionSource.swift','-o',binary],{stdio:'inherit'});if(compiled.status!==0)process.exit(compiled.status);
const processes=[];
function worker(command,args=[]) {
 const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});processes.push(child);
 const queue=[],waiters=[];let failed;
 readline.createInterface({input:child.stdout}).on('line',line=>{try{const data=JSON.parse(line);const waiter=waiters.shift();if(waiter)waiter(data);else queue.push(data);}catch{}});
 child.stderr.on('data',data=>process.stderr.write(data));
 child.on('error',error=>{failed=error;});
 return {send:data=>child.stdin.write((typeof data==='string'?data:JSON.stringify(data))+'\n'),next:()=>new Promise((resolve,reject)=>{if(failed)return reject(failed);if(queue.length)return resolve(queue.shift());const timer=setTimeout(()=>reject(new Error('Native test timeout')),5000);waiters.push(data=>{clearTimeout(timer);resolve(data);});})};
}
(async()=>{
 const helper=worker(path.resolve(process.argv[2]||'build/native/arm64/selection-helper'),[String(process.pid)]);
 const status=await helper.next();if(!status.accessibility)throw new Error('Accessibility permission unavailable; cannot verify native capture');
 helper.send({command:'configure',clipboard:false,selection:true,doubleCopy:false});
 const fallback=process.argv.includes('--fallback');
 const source=worker(binary,fallback?['--fallback']:[]);const ready=await source.next();
 helper.send({command:'capture',id:1,pid:ready.pid});let result;do{result=await helper.next();}while(result.id!==1);
 assert.equal(result.text,'Selection translation works across applications.');assert.equal(result.method,fallback?'copy':'accessibility');
 if(!fallback) { source.send('gesture');let gesture;do{gesture=await helper.next();}while(gesture.event!=='selection-gesture');assert.equal(gesture.application.pid,ready.pid);
 helper.send({command:'capture',id:2,pid:ready.pid});do{result=await helper.next();}while(result.id!==2);assert(result.text.length>5);assert.equal(result.method,'accessibility'); }
 source.send('quit');const end=await source.next();assert(end.clipboardUnchanged);
 helper.send({command:'quit'});
 console.log(fallback?'PASS: native copy fallback, original clipboard formats preserved.':'PASS: real cross-application AX selection, global drag gesture, recapture, original clipboard unchanged.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{for(const child of processes)child.stdin.end();});
