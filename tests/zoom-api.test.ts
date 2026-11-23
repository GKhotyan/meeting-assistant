import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Controller } from '../src/session/controller';
import { createApp } from '../src/server/app';
import { ZoomConnection } from '../src/zoom/connection';
test('Zoom API protects credentials and interactive input with app and origin authentication',async()=>{
  const root=mkdtempSync(join(tmpdir(),'zoom-api-'));
  const zoom=new ZoomConnection(root,async()=>({async start(){},async verify(){return false;},async problem(){return '';},async state(){throw Error();},async close(){},async frame(){return Buffer.from('image');},async input(){}}));
  const app=createApp(new Controller(root,()=>{throw Error('no recording');}),{password:'test',publicDir:join(process.cwd(),'public'),zoom});
  await new Promise<void>(r=>app.listen(0,'127.0.0.1',r));
  const url='http://127.0.0.1:'+(app.address() as any).port;
  const headers={Authorization:'Basic '+Buffer.from('assistant:test').toString('base64'),'Content-Type':'application/json',Origin:url};
  try {
    assert.equal((await fetch(url+'/api/settings/zoom')).status,401);
    assert.equal((await fetch(url+'/api/settings/zoom/browser/frame',{headers:{...headers,'Sec-Fetch-Site':'cross-site'}})).status,403);
    assert.equal((await fetch(url+'/api/settings/zoom/browser/input',{method:'POST',headers:{...headers,Origin:'https://evil.test'},body:JSON.stringify({type:'key',key:'Enter'})})).status,403);
    assert.equal((await fetch(url+'/api/settings/zoom',{headers})).status,200);
    const connected=await fetch(url+'/api/settings/zoom/connect',{method:'POST',headers,body:JSON.stringify({email:'bot@example.com',password:'secret'})});
    assert.equal(connected.status,202); assert.equal((await connected.text()).includes('secret'),false);
    await new Promise(r=>setTimeout(r,20));
    const image=await fetch(url+'/api/settings/zoom/browser/frame',{headers});
    assert.equal(image.status,200); assert.match(image.headers.get('content-type')!,/image\/jpeg/);
    assert.equal((await fetch(url+'/api/settings/zoom/browser/input',{method:'POST',headers,body:JSON.stringify({type:'click',x:-3,y:0})})).status,400);
    assert.equal((await fetch(url+'/api/settings/zoom',{method:'PUT',headers,body:'{}'})).status,405);
    assert.equal((await fetch(url+'/api/settings/zoom',{method:'DELETE',headers,body:'{}'})).status,200);
    assert.equal((await fetch(url+'/api/settings/zoom/browser/frame',{headers})).status,409);
  } finally {await zoom.close();await new Promise<void>(r=>app.close(()=>r()));}
});
