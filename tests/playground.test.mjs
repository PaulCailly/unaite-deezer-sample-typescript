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
