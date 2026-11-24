import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
test('SDK Pipe adapter strips unsupported fields and preserves ordinary media requests',async()=>{
 const calls:any[]=[];const nodes=new Map<string,any>();
 const fakeFetch=async(url:any,init:any)=>{calls.push({url,init});return new Response(JSON.stringify(url==='/api/session'?{csrf:'test-csrf',configured:true,authenticated:true,sdkAvailable:true,appId:'test'}:{data:{}}),{status:200,headers:{'Content-Type':'application/json'}});};
 const context:any={URL,Request,Response,console,document:{getElementById:(id:string)=>{if(!nodes.has(id))nodes.set(id,{addEventListener(){}});return nodes.get(id);}},window:{fetch:fakeFetch,addEventListener(){}}};
 runInNewContext(readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),context);
 await new Promise(r=>setImmediate(r));
 await context.window.fetch('https://pipe.deezer.com/api',{body:JSON.stringify({query:'query A { me { user { id } } }',variables:{},operationName:'A'})});
 assert.equal(calls.at(-1).url,'/api/pipe');
 assert.equal(calls.at(-1).init.headers['X-CSRF-Token'],'test-csrf');
 assert.deepEqual(JSON.parse(calls.at(-1).init.body),{query:'query A { me { user { id } } }',variables:{}});
 await context.window.fetch('https://media.deezer.com/song');assert.equal(calls.at(-1).url,'https://media.deezer.com/song');
});
