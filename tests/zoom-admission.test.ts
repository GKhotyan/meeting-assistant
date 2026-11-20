import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForZoomMeetingAdmission } from "../vendor/vexa/join/zoom/admission";
import { AdmissionError } from "../vendor/vexa/join/shared/admission";
function page(text: string): any {
  const locator: any = { first: () => locator, isVisible: async () => false, count: async () => 0 };
  return {
    locator: () => locator,
    evaluate: async (fn: any, arg: any) => {
      (globalThis as any).document = { body: { innerText: text } };
      try { return fn(arg); } finally { delete (globalThis as any).document; }
    },
    waitForTimeout: async () => {},
  };
}
test("sign-in-only admission gate is authentication, not a retryable bot block", async () => {
  await assert.rejects(waitForZoomMeetingAdmission(page("Sign in to join"), 0, {}),
    (error: any) => error instanceof AdmissionError && error.outcome === "auth_session_missing");
});
test("actual bot warning with a sign-in option still reports the bot-block reason", async () => {
  await assert.rejects(waitForZoomMeetingAdmission(page("Automated bots aren't allowed. Sign in to join"), 0, {}),
    (error: any) => error instanceof AdmissionError && error.outcome === "denial" && /zoom_bot_blocked/.test(error.message) && !/requires.*RTMS/i.test(error.message));
});
test('loading meeting shell without Leave control is not admitted',async()=>{
  const p=page('Joining Meeting…');
  p.locator=(selector:string)=>{const l:any={first:()=>l,isVisible:async()=>selector==='.meeting-app',count:async()=>0};return l;};
  await assert.rejects(waitForZoomMeetingAdmission(p,0,{}));
});
test('a loading footer with Leave but disabled participant controls is not admitted',async()=>{
  const p=page('Joining Meeting…');
  p.locator=(selector:string)=>{const l:any={first:()=>l,isVisible:async()=>selector.includes('Leave'),isEnabled:async()=>selector.includes('Leave'),getAttribute:async()=>null,count:async()=>1};return l;};
  await assert.rejects(waitForZoomMeetingAdmission(p,0,{}));
});
test('zero participants in an enabled loading footer is not proof of admission',async()=>{
  const p=page('Joining Meeting…');
  p.locator=(selector:string)=>{const l:any={first:()=>l,isVisible:async()=>selector.includes('Leave'),isEnabled:async()=>true,getAttribute:async()=> 'open the participants list pane,[0] particpants',count:async()=>1};return l;};
  await assert.rejects(waitForZoomMeetingAdmission(p,0,{}));
});
