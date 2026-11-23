import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setPreJoinName, applyMeetingName } from '../src/zoom/meeting-name';
test('authenticated pre-join replaces account identity with the requested meeting name',async()=>{
  let value='Account Name';
  const field:any={first(){return this;},async waitFor(){},async isVisible(){return true;},async fill(v:string){value=v;},async inputValue(){return value;}};
  assert.equal(await setPreJoinName({locator:()=>field} as any,'PIM Assistant'),true);
  assert.equal(value,'PIM Assistant');
});
test('a missing pre-join field or host-restricted rename never claims name was applied',async()=>{
  const locator:any={first(){return this;},filter(){return this;},getByRole(){return this;},locator(){return this;},async isVisible(){return false;},async click(){throw Error('restricted');},async count(){return 0;}};
  const page:any={locator:()=>locator,getByRole:()=>locator};
  assert.equal(await setPreJoinName(page,'PIM Assistant'),false);
  assert.equal(await applyMeetingName(page,'PIM Assistant'),'unavailable');
});
test('participant names must match exactly, not a substring of the account name or row actions',async()=>{
  const locator:any={first(){return this;},filter(){return this;},getByRole(){return this;},locator(){return this;},
    async waitFor(){},async isVisible(){return true;},async click(){},async innerText(){return 'Assistant Supervisor (You)\nMore';},
    async hover(){throw Error('restricted');}};
  const page:any={locator:()=>locator,getByRole:()=>locator};
  assert.notEqual(await applyMeetingName(page,'Assistant'),'applied');
  assert.notEqual(await applyMeetingName(page,'More'),'applied');
});
