import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request as httpRequest} from 'node:http';
import {createHash} from 'node:crypto';
import {createApp} from '../src/app.ts';
const origin='http://localhost:3000';
async function fixture(t:any, mediaTransport?:any){
 let now=1_000_000; const calls:any[]=[];let failRefresh=false; let gate:Promise<void>|undefined;let release=()=>{};
 const transport=async(url:string,body:any,token?:string)=>{calls.push({url,body,token});if(body.grant_type==='authorization_code'){if(gate)await gate;}if(body.grant_type==='authorization_code')return {status:200,data:{access_token:'access-one',refresh_token:'refresh-one',expires_in:60}};if(body.grant_type==='refresh_token')return failRefresh?{status:400,data:{error:'invalid_grant'}}:{status:200,data:{access_token:'access-two',refresh_token:'refresh-two',expires_in:60}};return {status:200,data:{data:{me:{user:{id:'1'}}},errors:body.query==='bad'?[{message:'unauthorized'}]:undefined}};};
 const server=createServer(createApp({clientId:'test-client',appId:'test-app',transport,mediaTransport,now:()=>now}));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
 const base=`http://127.0.0.1:${(server.address() as any).port}`;let cookie='',csrf='';
 async function req(path:string,method='GET',body?:any,headers:any={}){const r=await new Promise<Response>((resolve,reject)=>{const q=httpRequest(base+path,{method,headers:{Host:'localhost:3000',Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json',...headers}},res=>{const chunks:Buffer[]=[];res.on('data',c=>chunks.push(c));res.on('end',()=>{const h=new Headers();for(const [k,v] of Object.entries(res.headers))if(v)h.set(k,Array.isArray(v)?v.join(';'):v);resolve(new Response(Buffer.concat(chunks),{status:res.statusCode,headers:h}));});});q.on('error',reject);q.end(body===undefined?undefined:JSON.stringify(body));});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie')!.split(';')[0];return r;}
 async function session(){const r=await req('/api/session');assert.equal(r.headers.get('referrer-policy'),'same-origin');const d=await r.json() as any;csrf=d.csrf;return d;}
 async function login(){await session();const r=await req('/login','POST',{});assert.equal(r.status,303);return new URL(r.headers.get('location')!);}
 async function authorize(){const u=await login();const r=await req('/callback?state='+u.searchParams.get('state')+'&code=test-code');assert.equal(r.status,303);await session();}
 return {req,session,login,authorize,calls,hold:()=>{gate=new Promise<void>(r=>{release=r;});},release:()=>release(),advance:()=>{now+=40_000;},expireFlow:()=>{now+=601_000;},fail:()=>{failRefresh=true;}};
}
test('PKCE binds one-time callback to cookie, uses JSON token exchange, rotates session',async t=>{const f=await fixture(t);const u=await f.login();assert.equal(u.searchParams.get('scope'),'all');assert.equal(u.searchParams.get('redirect_uri'),origin+'/callback');assert.equal(u.searchParams.get('code_challenge_method'),'S256');const state=u.searchParams.get('state');assert.equal((await f.req('/callback?state=bad&code=x')).status,400);assert.equal((await f.req('/callback?state='+state+'&code=x','GET',undefined,{Cookie:''})).status,400);const r=await f.req('/callback?state='+state+'&code=x');assert.equal(r.status,303);assert.match(r.headers.get('set-cookie')!,/HttpOnly/);assert.equal(createHash('sha256').update(f.calls[0].body.code_verifier).digest('base64url'),u.searchParams.get('code_challenge'));assert.equal((await f.req('/callback?state='+state+'&code=x')).status,400);assert.equal((await f.session()).authenticated,true);});
test('expired and duplicate callbacks fail before token exchange',async t=>{const f=await fixture(t);const u=await f.login();const state=u.searchParams.get('state');assert.equal((await f.req(`/callback?state=${state}&state=${state}&code=x`)).status,400);f.expireFlow();assert.equal((await f.req(`/callback?state=${state}&code=x`)).status,400);assert.equal(f.calls.length,0);});
test('host, origin, CSRF, authentication and static allowlist protect endpoints',async t=>{const f=await fixture(t);assert.equal((await f.req('/api/session','GET',undefined,{Host:'evil.example'})).status,403);await f.session();assert.equal((await f.req('/login','POST',{}, {Origin:'https://evil.example'})).status,403);assert.equal((await f.req('/login','POST',{}, {'X-CSRF-Token':'wrong'})).status,403);assert.equal((await f.req('/api/pipe','POST',{query:'q'})).status,401);assert.equal((await f.req('/.env')).status,404);assert.equal((await f.req('/src/app.ts')).status,404);});
test('refresh serializes concurrent calls, rotates token, and failures clear authentication',async t=>{const f=await fixture(t);await f.authorize();f.advance();const responses=await Promise.all([f.req('/api/token','POST',{}),f.req('/api/token','POST',{})]);for(const r of responses)assert.equal((await r.json() as any).access_token,'access-two');assert.equal(f.calls.filter(x=>x.body.grant_type==='refresh_token').length,1);f.fail();assert.equal((await f.req('/api/refresh','POST',{})).status,401);assert.equal((await f.session()).authenticated,false);assert.equal(f.calls.at(-1).body.refresh_token,'refresh-two');});
test('Pipe preserves GraphQL errors; body bounded; logout removes session',async t=>{const f=await fixture(t);await f.authorize();const r=await f.req('/api/pipe','POST',{query:'bad'});assert.equal(r.status,200);assert.ok((await r.json() as any).errors.length);assert.equal(f.calls.at(-1).url,'https://pipe.deezer.com/api');assert.equal((await f.req('/api/pipe','POST',{query:'x'.repeat(70000)})).status,413);assert.equal((await f.req('/logout','POST',{})).status,200);assert.equal((await f.session()).authenticated,false);});

test('logout during code exchange cannot resurrect authenticated session',async t=>{const f=await fixture(t);const u=await f.login();f.hold();const callback=f.req('/callback?state='+u.searchParams.get('state')+'&code=x');while(!f.calls.length)await new Promise(r=>setImmediate(r));assert.equal((await f.req('/logout','POST',{})).status,200);f.release();assert.equal((await callback).status,400);assert.equal((await f.session()).authenticated,false);});
test('new login invalidates previous exchange still in flight',async t=>{const f=await fixture(t);const u=await f.login();f.hold();const callback=f.req('/callback?state='+u.searchParams.get('state')+'&code=x');while(!f.calls.length)await new Promise(r=>setImmediate(r));await f.login();f.release();assert.equal((await callback).status,400);assert.equal((await f.session()).authenticated,false);});

test('media relay requires login and rejects arbitrary hosts, redirects and malformed ranges',async t=>{
 const seen:any[]=[];
 const f=await fixture(t,async(url:string,range:string)=>{seen.push({url,range});return {status:206,body:Buffer.from([0,1,2]),headers:{'content-type':'audio/mpeg','content-range':'bytes 0-2/100'}};});
 const url='https://cdnt-stream.dzcdn.net/media/1/1/a/audio.mp3?hdnea=test';
 await f.session();assert.equal((await f.req('/api/media','POST',{url})).status,401);
 await f.authorize();
 for(const bad of ['http://cdnt-stream.dzcdn.net/media/a.mp3?hdnea=x','https://localhost/media/a.mp3?hdnea=x','https://cdnt-stream.dzcdn.net.evil.test/media/a.mp3?hdnea=x','https://user@cdnt-stream.dzcdn.net/media/a.mp3?hdnea=x','https://cdnt-stream.dzcdn.net:8443/media/a.mp3?hdnea=x','https://cdnt-stream.dzcdn.net/private?hdnea=x'])assert.equal((await f.req('/api/media','POST',{url:bad})).status,400);
 assert.equal((await f.req('/api/media','POST',{url,range:'bytes=0-1,2-3'})).status,400);
 assert.equal(seen.length,0);
 const r=await f.req('/api/media','POST',{url,range:'bytes=0-2'});
 assert.equal(r.status,206);assert.equal(r.headers.get('content-type'),'audio/mpeg');assert.equal(r.headers.get('content-range'),'bytes 0-2/100');assert.deepEqual([...new Uint8Array(await r.arrayBuffer())],[0,1,2]);assert.equal(seen.length,1);
});
test('playground assets are reachable without exposing source or credentials',async t=>{const f=await fixture(t);for(const path of ['/playground','/playground.mjs','/playground.css']){const r=await f.req(path);assert.equal(r.status,200,path);assert.match(r.headers.get('cache-control')!,/no-store/);}assert.equal((await f.req('/src/app.ts')).status,404);});

// The OAuth server redirects first-time users to the account login page.
test('login form permits the complete Deezer redirect chain without wildcard destinations',async t=>{
 const f=await fixture(t);
 for(const path of ['/', '/api/session']){
  const r=await f.req(path);
  const directive=r.headers.get('content-security-policy')!.split(';').map(x=>x.trim()).find(x=>x.startsWith('form-action '));
  assert.deepEqual(directive!.split(/\s+/).slice(1),["'self'",'https://oauth.deezer.com','https://account.deezer.com']);
 }
});
