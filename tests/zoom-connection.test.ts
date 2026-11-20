import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoomConnection, LoginDriver } from '../src/zoom/connection';
import { ZoomSettings } from '../src/integrations/zoom-settings';
const state:any = {cookies:[{name:'cred',value:'session-secret',domain:'.zoom.us',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]};
const root = () => mkdtempSync(join(tmpdir(),'zoom-connect-'));
const tick = () => new Promise(r=>setTimeout(r,15));
function driver(auth = false) {
  const value = { auth, closed:false, submitted:false, failure:'',
    async start(email:string,password:string) { value.submitted = email === 'bot@example.com' && password === 'secret'; },
    async verify() { return value.auth; }, async problem() { return value.failure; },
    async state() { return state; }, async frame() { return Buffer.from('frame'); },
    async input() {}, async close() { value.closed=true; } };
  return value satisfies LoginDriver;
}
test('login challenges remain interactive; verified login alone persists the session', async () => {
  const dir=root(), d=driver(), service=new ZoomConnection(dir,async()=>d,{pollMs:5});
  service.connect({email:'bot@example.com',password:'secret'}); await tick();
  assert.equal(service.metadata().status,'action_required');
  assert.equal(new ZoomSettings(dir).session(),undefined);
  d.auth=true; await tick();
  assert.equal(service.metadata().status,'connected'); assert.equal(d.closed,true);
  assert.deepEqual(new ZoomSettings(dir).session(),state);
  assert.equal(JSON.stringify(service.metadata()).includes('secret'),false); await service.close();
});
test('cancelled login completion cannot replace the account', async () => {
  let release!:(d:LoginDriver)=>void;
  const dir=root(), d=driver(true), service=new ZoomConnection(dir,()=>new Promise(r=>release=r));
  service.connect({email:'bot@example.com',password:'secret'}); await service.cancel(); release(d); await tick();
  assert.equal(d.closed,true); assert.equal(new ZoomSettings(dir).session(),undefined); await service.close();
});
test('failed saved-session check requires reconnect and disconnect restores guest mode', async () => {
  const dir=root(); new ZoomSettings(dir).save('bot@example.com',state);
  const service=new ZoomConnection(dir,async()=>driver(false)); service.check(); await tick();
  assert.equal(service.metadata().status,'sign_in_required');
  await service.disconnect(); assert.equal(service.metadata().status,'not_connected'); await service.close();
});
test('interactive browser validates inputs and expires unattended login', async () => {
  const service=new ZoomConnection(root(),async()=>driver(),{pollMs:5,timeoutMs:25});
  assert.throws(()=>service.connect({email:'bad',password:'secret'}));
  service.connect({email:'bot@example.com',password:'secret'}); await tick();
  await assert.rejects(()=>service.input({type:'click',x:-1,y:30}),/invalid/i);
  await assert.rejects(()=>service.input({type:'text',text:'x'.repeat(4097)}),/invalid/i);
  await new Promise(r=>setTimeout(r,40)); assert.equal(service.metadata().status,'error');
  await assert.rejects(()=>service.frame(),/no active/i); await service.close();
});
test('a disconnect waiting for old browser cleanup cannot erase a newer account',async()=>{
  const dir=root(),old=driver(),fresh=driver(true);
  let release!:()=>void;old.close=()=>new Promise<void>(r=>release=r);
  let count=0;const service=new ZoomConnection(dir,async()=>count++?fresh:old,{pollMs:5});
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  const closing=service.disconnect();
  service.connect({email:'new@example.com',password:'secret'});await tick();
  release();await closing;
  assert.equal(service.metadata().status,'connected');assert.equal(service.metadata().email,'new@example.com');await service.close();
});
test('stale browser failure cannot overwrite a newer pending login',async()=>{
  const old=driver(),fresh=driver();let release!:()=>void;
  old.verify=async()=>{throw Error('crash');};old.close=()=>new Promise<void>(r=>release=r);
  let count=0;const service=new ZoomConnection(root(),async()=>count++?fresh:old,{pollMs:5});
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  service.connect({email:'new@example.com',password:'secret'});await tick();release();await tick();
  assert.equal(service.metadata().status,'action_required');assert.equal(service.metadata().email,'new@example.com');await service.close();
});
test('a screenshot interrupted by successful login or cancellation returns a recoverable conflict',async()=>{
  const d=driver();let reject!:(error:Error)=>void;
  d.frame=()=>new Promise((_r,j)=>reject=j);
  const service=new ZoomConnection(root(),async()=>d,{pollMs:5});
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  const image=service.frame();await service.cancel();reject(Error('Target closed'));
  await assert.rejects(()=>image,(e:any)=>e.status===409);await service.close();
});
test('requesting a frame while disconnected does not block the next sign-in browser',async()=>{
  const service=new ZoomConnection(root(),async()=>driver(),{pollMs:5});
  await assert.rejects(()=>service.frame(),/no active/i);
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  assert.equal((await service.frame()).toString(),'frame');await service.close();
});
