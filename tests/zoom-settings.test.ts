import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, symlinkSync, mkdirSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ZoomSettings } from '../src/integrations/zoom-settings';
import { DeepgramSettings } from '../src/integrations/deepgram';
const root = () => mkdtempSync(join(tmpdir(), 'zoom-settings-'));
const state = { cookies: [{name:'cred',value:'private-zoom-session',domain:'.zoom.us',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Lax' as const}],origins:[] };
test('Zoom session is encrypted, survives restart and preserves Deepgram in both directions', () => {
  const dir = root(), zoom = new ZoomSettings(dir), dg = new DeepgramSettings(dir);
  assert.equal(zoom.metadata().status, 'not_connected');
  dg.save('dg-secret'); zoom.save('bot@example.com', state);
  assert.deepEqual(new ZoomSettings(dir).session(), state);
  assert.equal(JSON.stringify(zoom.metadata()).includes('private-zoom-session'), false);
  assert.equal(readFileSync(join(dir,'settings/api-keys.json'),'utf8').includes('private-zoom-session'), false);
  dg.save('dg-replaced'); assert.deepEqual(zoom.session(), state);
  dg.remove(); assert.deepEqual(zoom.session(), state);
  dg.save('dg-final'); zoom.disconnect();
  assert.equal(dg.key(),'dg-final'); assert.equal(zoom.session(), undefined);
});
test('expired configured sessions require sign-in rather than silently becoming guest', () => {
  const zoom = new ZoomSettings(root()); zoom.save('bot@example.com',state); zoom.markExpired();
  assert.equal(zoom.metadata().status,'sign_in_required');
  assert.throws(()=>zoom.session(),/sign.in required/i);
  zoom.disconnect(); assert.equal(zoom.session(),undefined);
});
test('malformed or non-Zoom session state cannot replace a working account', () => {
  const zoom = new ZoomSettings(root()); zoom.save('bot@example.com',state);
  for (const invalid of [null,{}, {cookies:[],origins:[]}, {...state,cookies:[{...state.cookies[0],domain:'.evil.test'}]}, {...state,origins:[{origin:'https://evil.test',localStorage:[]}]}])
    assert.throws(()=>zoom.save('bot@example.com',invalid as any));
  assert.deepEqual(zoom.session(),state);
});
test('Zoom storage refuses missing encryption keys and symbolic links', () => {
  const dir = root(), zoom = new ZoomSettings(dir); zoom.save('bot@example.com',state);
  unlinkSync(join(dir,'secrets/master.key'));
  assert.throws(()=>zoom.save('bot@example.com',state),/encryption/i);
  const linked = root(), target = root(); mkdirSync(join(target,'actual'));
  symlinkSync(join(target,'actual'),join(linked,'settings'));
  assert.throws(()=>new ZoomSettings(linked).save('bot@example.com',state),/unsafe/i);
});
