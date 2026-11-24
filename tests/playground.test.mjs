import test from 'node:test';
import assert from 'node:assert/strict';
import { requestPayload, executeQuery } from '../public/playground.mjs';
test('playground rejects empty query, invalid or non-object variables and oversized requests',()=>{
 for(const [query,vars] of [['','{}'],['query { me { user { id } } }','oops'],['query { x }','[]'],['query { x }','null'],['query { x }','1'],['x'.repeat(70000),'{}']])assert.throws(()=>requestPayload(query,vars));
 assert.deepEqual(requestPayload('query Search($q: String!) { search(query:$q) { __typename } }','{"q":"Daft Punk"}'),{query:'query Search($q: String!) { search(query:$q) { __typename } }',variables:{q:'Daft Punk'}});
 assert.deepEqual(requestPayload('{ __typename }',''),{query:'{ __typename }',variables:{}});
});
test('playground sends only query and variables through the local CSRF-protected relay and preserves errors',async()=>{
 let sent;
 const result=await executeQuery('{ __typename }','{}','csrf-test',async(url,options)=>{sent={url,options};return new Response(JSON.stringify({data:null,errors:[{message:'Access denied'}]}),{status:200});});
 assert.equal(sent.url,'/api/pipe');assert.equal(sent.options.method,'POST');assert.equal(sent.options.credentials,'same-origin');assert.equal(sent.options.cache,'no-store');assert.equal(sent.options.headers['X-CSRF-Token'],'csrf-test');assert.equal(sent.options.headers.Authorization,undefined);assert.deepEqual(JSON.parse(sent.options.body),{query:'{ __typename }',variables:{}});assert.equal(result.status,200);assert.equal(result.body.errors[0].message,'Access denied');
});
test('playground surfaces HTTP failures and never sends malformed variables',async()=>{
 let called=false;await assert.rejects(()=>executeQuery('{ x }','[]','csrf',async()=>{called=true;}));assert.equal(called,false);
 const result=await executeQuery('{ x }','{}','csrf',async()=>new Response(JSON.stringify({error:'login_required'}),{status:401}));assert.equal(result.status,401);assert.equal(result.body.error,'login_required');
});
test('editor blocks overlapping execution, snapshots inputs and discards cleared responses',async()=>{
 const old={document:globalThis.document,window:globalThis.window,fetch:globalThis.fetch};
 const elements=new Map();const events={};const pending=[];let holdSession;
 const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='example'?'profile':'',textContent:'',disabled:false,addEventListener(name,fn){this[name]=fn;}});return elements.get(id);};
 globalThis.document={getElementById:element};globalThis.window={addEventListener(name,fn){events[name]=fn;}};
 globalThis.fetch=async(url,options)=>{if(url==='/api/session'){if(holdSession)await holdSession;return Response.json({authenticated:true,csrf:'test'});}return new Promise(resolve=>pending.push({body:JSON.parse(options.body),resolve}));};
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  await import('../public/playground.mjs?ui-regression');await tick();
  let resume;holdSession=new Promise(resolve=>resume=resolve);
  element('query-editor').value='query Original { __typename }';
  const first=element('query-form').submit({preventDefault(){}});
  element('query-editor').value='query Edited { __typename }';resume();holdSession=undefined;await tick();
  assert.equal(pending[0].body.query,'query Original { __typename }');
  await element('recheck').click();await tick();assert.equal(element('execute').disabled,true);
  await element('query-form').submit({preventDefault(){}});assert.equal(pending.length,1);
  element('clear').click();pending[0].resolve(Response.json({data:{marker:'late'}}));await first;
  assert.equal(element('result').textContent,'');assert.equal(element('request-status').textContent,'');assert.equal(element('execute').disabled,false);
  const second=element('query-form').submit({preventDefault(){}});await tick();events.pagehide();pending[1].resolve(Response.json({data:{marker:'hidden'}}));await second;assert.equal(element('result').textContent,'');
 }finally{Object.assign(globalThis,old);}
});
