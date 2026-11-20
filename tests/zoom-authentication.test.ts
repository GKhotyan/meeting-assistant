import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticatedView } from '../src/zoom/authentication';
test('only a signed-in Zoom profile counts as authentication, not a URL or cookie jar', () => {
  const valid = {url:'https://us05web.zoom.us/profile',password:false,profile:true,signOut:true,challenge:false};
  assert.equal(authenticatedView(valid),true);
  for (const change of [{url:'https://zoom.us/signin'}, {url:'https://evil.test/profile'}, {password:true}, {profile:false}, {signOut:false}, {challenge:true}])
    assert.equal(authenticatedView({...valid,...change}),false);
});
