import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchMedia, validMedia} from '../src/media.ts';
const url='https://cdnt-stream.dzcdn.net/media/1/1/a/audio.mp3?hdnea=test';
test('CDN transport forwards range only, forbids redirects, rejects non-audio and oversized media',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 let calls=0;
 globalThis.fetch=(async(_url:any,init:any)=>{calls++;assert.equal(init.redirect,'error');assert.deepEqual(init.headers,{Range:'bytes=0-2'});return new Response(new Uint8Array([0,1,2]),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Range':'bytes 0-2/100','Set-Cookie':'do-not-forward'}});}) as typeof fetch;
 const media=await fetchMedia(url,'bytes=0-2');assert.equal(media.status,206);assert.deepEqual([...media.body],[0,1,2]);assert.equal(media.headers['set-cookie'],undefined);
 await assert.rejects(fetchMedia('https://localhost/'));assert.equal(calls,1);
 globalThis.fetch=(async()=>new Response('',{status:302,headers:{Location:'https://evil.invalid'}})) as typeof fetch;
 await assert.rejects(fetchMedia(url));
 globalThis.fetch=(async()=>new Response('html',{headers:{'Content-Type':'text/html'}})) as typeof fetch;
 await assert.rejects(fetchMedia(url));
 globalThis.fetch=(async()=>new Response(new Uint8Array(32*1024*1024+1),{headers:{'Content-Type':'audio/mpeg'}})) as typeof fetch;
 await assert.rejects(fetchMedia(url));
 for(const range of ['bytes=2-1','bytes=0-1,2-3','bytes=-10','oops'])assert.equal(validMedia(url,range),false);
});
