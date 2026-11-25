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
    async requiresAction() { return true; },
    async start(email:string,password:string) { value.submitted = email === 'bot@example.com' && password === 'secret'; },
    async verify() { return value.auth; }, async problem() { return value.failure; },
    async state() { return state; }, async frame() { return Buffer.from('frame'); },
    async input() {}, async close() { value.closed=true; } };
  return value satisfies LoginDriver;
}
test('Reconnect reuses the encrypted saved password for the same account, including expired sessions',async()=>{
  const dir=root(),settings=new ZoomSettings(dir);settings.save('bot@example.com',state,'secret');settings.markExpired();
  const d=driver(true),service=new ZoomConnection(dir,async()=>d);
  assert.equal(service.metadata().passwordSaved,true);
  service.connect({email:'bot@example.com',password:''});await tick();
  assert.equal(d.submitted,true);assert.equal(service.metadata().status,'connected');
  assert.equal(JSON.stringify(service.metadata()).includes('secret'),false);await service.close();
});
test('saved passwords cannot be reused for another email or after disconnect',async()=>{
  const dir=root(),settings=new ZoomSettings(dir);settings.save('bot@example.com',state,'secret');
  const service=new ZoomConnection(dir,async()=>driver(true));
  assert.throws(()=>service.connect({email:'other@example.com',password:''}),/password/);
  await service.disconnect();assert.equal(service.metadata().passwordSaved,false);
  assert.throws(()=>service.connect({email:'bot@example.com',password:''}),/password/);await service.close();
});
test('an explicitly entered password replaces the saved password only after verified login',async()=>{
  const dir=root(),settings=new ZoomSettings(dir);settings.save('bot@example.com',state,'old-password');
  const d=driver(true),service=new ZoomConnection(dir,async()=>d);
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  assert.equal(d.submitted,true);assert.equal(settings.recoveryAccount()?.password,'secret');await service.close();
});
test('normal sign-in stays connecting until verified without asking for manual assistance',async()=>{
  const d=driver(),service=new ZoomConnection(root(),async()=>d,{pollMs:5});
  d.requiresAction=async()=>false;
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  assert.equal(service.metadata().status,'connecting');
  assert.equal(service.metadata().message,'Verifying your Zoom session…');
  d.auth=true;await tick();assert.equal(service.metadata().status,'connected');await service.close();
});
test('unrecognized sign-in page eventually offers manual assistance instead of waiting indefinitely',async()=>{
  const d=driver(),service=new ZoomConnection(root(),async()=>d,{pollMs:5,actionWaitMs:0});
  d.requiresAction=async()=>false;
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  assert.equal(service.metadata().status,'action_required');await service.close();
});
test('login challenges remain interactive; verified login alone persists the session', async () => {
  const dir=root(), d=driver(), service=new ZoomConnection(dir,async()=>d,{pollMs:5});
  service.connect({email:'bot@example.com',password:'secret'}); await tick();
  assert.equal(service.metadata().status,'action_required');
  assert.equal(new ZoomSettings(dir).session(),undefined);
  d.auth=true; await tick();
  assert.equal(service.metadata().status,'connected'); assert.equal(d.closed,true);
  assert.deepEqual(new ZoomSettings(dir).session(),state);
  assert.equal(new ZoomSettings(dir).recoveryAccount()?.password,'secret');
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
test('a password rejected before interactive correction is not saved for automatic sign-in',async()=>{
  const dir=root(),d=driver(),service=new ZoomConnection(dir,async()=>d,{pollMs:5});
  d.failure='Zoom did not accept the credentials.';
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  d.auth=true;await tick();
  assert.equal(service.metadata().status,'connected');
  assert.equal(new ZoomSettings(dir).recoveryAccount(),undefined);await service.close();
});
test('editing a credential field in the login browser discards the original submitted password',async()=>{
  const dir=root(),d=driver(),service=new ZoomConnection(dir,async()=>d,{pollMs:5});
  d.input=async()=>({credentialsChanged:true});
  service.connect({email:'bot@example.com',password:'secret'});await tick();
  await service.input({type:'text',text:'corrected-password'});d.auth=true;await tick();
  assert.equal(new ZoomSettings(dir).recoveryAccount(),undefined);await service.close();
});
