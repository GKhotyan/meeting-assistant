import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoomSettings } from '../src/integrations/zoom-settings';
import { recoverZoomSession } from '../src/zoom/recovery';
import type { LoginDriver } from '../src/zoom/connection';
const state:any={cookies:[{name:'cred',value:'old',domain:'.zoom.us',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax'}],origins:[]};
const fresh={...state,cookies:[{...state.cookies[0],value:'new'}]};
function fixture() {
  const settings=new ZoomSettings(mkdtempSync(join(tmpdir(),'zoom-recovery-')));
  settings.save('bot@example.com',state,'private-password');
  let closed=0,submissions=0;
  const driver:LoginDriver={async start(email,password){assert.equal(email,'bot@example.com');assert.equal(password,'private-password');submissions++;},async verify(){return true;},async state(){return fresh;},async close(){closed++;},async problem(){return '';},async frame(){return Buffer.alloc(0);},async input(){}};
  return {settings,driver,signal:new AbortController(),closed:()=>closed,submissions:()=>submissions};
}
test('automatic sign-in persists a verified fresh session and closes the login browser',async()=>{
  const f=fixture();f.settings.markExpired();
  assert.deepEqual(await recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver),fresh);
  assert.deepEqual(f.settings.session(),fresh);assert.equal(f.closed(),1);assert.equal(f.submissions(),1);
});
test('challenge or rejected credentials requires Settings without exposing a browser error',async()=>{
  const f=fixture();f.driver.verify=async()=>false;
  f.driver.requiresAction=async()=>true;
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver),/Settings/);
  assert.equal(f.settings.metadata().status,'sign_in_required');assert.equal(f.closed(),1);assert.equal(f.submissions(),1);
});
test('automatic sign-in waits for authentication to finish without submitting credentials again',async()=>{
  const f=fixture();let checks=0;
  f.driver.verify=async()=>++checks>=3;
  f.driver.requiresAction=async()=>false;
  assert.deepEqual(await recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver,undefined,{pollMs:1,timeoutMs:1000}),fresh);
  assert.deepEqual(f.settings.session(),fresh);
  assert.equal(f.submissions(),1);assert.equal(f.closed(),1);
});
test('automatic sign-in stops waiting at its deadline and cannot save a late verification',async()=>{
  const f=fixture();let release!:(valid:boolean)=>void;
  f.driver.verify=()=>new Promise(resolve=>release=resolve);
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver,undefined,{pollMs:1,timeoutMs:20}),/Settings/);
  assert.equal(f.closed(),1);assert.equal(f.settings.metadata().status,'sign_in_required');
  release(true);await new Promise(r=>setImmediate(r));
  assert.equal(f.settings.metadata().status,'sign_in_required');
});
test('stop during the polling interval closes the browser without expiring the account',async()=>{
  const f=fixture();
  f.driver.verify=async()=>false;
  f.driver.requiresAction=async()=>false;
  const task=recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver,undefined,{pollMs:1000,timeoutMs:2000});
  setTimeout(()=>f.signal.abort(),20);
  await assert.rejects(task,{name:'AbortError'});
  assert.equal(f.closed(),1);assert.deepEqual(f.settings.session(),state);
});
test('rejected credentials stop recovery immediately',async()=>{
  const f=fixture();f.driver.verify=async()=>false;
  f.driver.problem=async()=> 'Zoom did not accept the credentials.';
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver,undefined,{pollMs:1,timeoutMs:1000}),/Settings/);
  assert.equal(f.closed(),1);assert.equal(f.submissions(),1);
});
test('recovery diagnostics report a safe stage without raw browser error contents',async(t)=>{
  const f=fixture();const lines:unknown[][]=[];
  t.mock.method(console,'warn',(...args:unknown[])=>{lines.push(args);});
  f.driver.start=async()=>{throw Error('private-password cookie=secret bot@example.com');};
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver),/Settings/);
  const log=JSON.stringify(lines);
  assert.match(log,/submitting/);assert.match(log,/browser_error/);
  assert.doesNotMatch(log,/private-password|cookie=secret|bot@example.com/);
});
test('legacy session without a saved password does not open a login browser',async()=>{
  const f=fixture();f.settings.disconnect();f.settings.save('bot@example.com',state);
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>{assert.fail('must not open');}),/Settings/);
});
test('stop interrupts a hanging sign-in, closes it, and cannot persist its eventual result',async()=>{
  const f=fixture();let release!:()=>void;
  f.driver.start=async()=>{f.signal.abort();await new Promise<void>(r=>release=r);};
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver),{name:'AbortError'});
  assert.equal(f.closed(),1);release();await new Promise(r=>setImmediate(r));
  assert.deepEqual(f.settings.session(),state);
});
test('disconnect or account replacement during sign-in cannot be overwritten',async()=>{
  for(const replace of [false,true]) {
    const f=fixture();f.driver.verify=async()=>{f.settings.disconnect();if(replace)f.settings.save('other@example.com',state,'other-password');return true;};
    await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver));
    assert.equal(f.settings.metadata().email,replace?'other@example.com':'');assert.equal(f.closed(),1);
  }
});
test('raw sign-in errors never expose the stored password',async()=>{
  const f=fixture();f.driver.start=async()=>{throw Error('private-password');};
  await assert.rejects(recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver),(error:any)=>/Settings/.test(error.message)&&!error.message.includes('private-password'));
  assert.equal(f.closed(),1);
});
test('worker delegates persistence instead of writing credentials across processes',async()=>{
  const f=fixture();let persisted=false;
  const result=await recoverZoomSession(f.settings,f.signal.signal,async()=>f.driver,async(account,state)=>{
    assert.equal(account.password,'private-password');assert.deepEqual(state,fresh);persisted=true;return true;
  });
  assert.equal(persisted,true);assert.deepEqual(result,fresh);
  assert.deepEqual(f.settings.session(),state);
});
