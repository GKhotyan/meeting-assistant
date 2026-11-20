import { AppError } from '../session/types';
import { ZoomSettings, ZoomState } from '../integrations/zoom-settings';
import { createLoginBrowser } from './login-browser';
export type BrowserInput = {type:'click';x:number;y:number} | {type:'key';key:string} | {type:'text';text:string} | {type:'scroll';deltaY:number};
export interface LoginDriver {
  start(email:string,password:string):Promise<void>;
  verify():Promise<boolean>;
  problem():Promise<string>;
  state():Promise<ZoomState>;
  frame():Promise<Buffer>;
  input(action:BrowserInput):Promise<void>;
  close():Promise<void>;
}
type Status = 'not_connected'|'connecting'|'action_required'|'connected'|'sign_in_required'|'error';
export class ZoomConnection {
  private settings:ZoomSettings;
  private active?:LoginDriver;
  private generation=0;
  private timer?:NodeJS.Timeout;
  private deadline?:NodeJS.Timeout;
  private transient?:{status:Status;message:string;email:string};
  private busy=false;
  private checking=false;
  private operations:Promise<unknown>=Promise.resolve();
  constructor(root:string,private factory:(state?:ZoomState)=>Promise<LoginDriver>=createLoginBrowser,private timing={pollMs:3000,timeoutMs:900000} as {pollMs?:number;timeoutMs?:number}) {
    this.settings=new ZoomSettings(root);
  }
  metadata() { return {...(this.transient || this.settings.metadata()), browserAvailable:!!this.active && !this.checking}; }
  private clearTimers() { clearTimeout(this.timer); clearTimeout(this.deadline); }
  async cancel() {
    this.generation++; this.clearTimers(); this.transient=undefined; this.checking=false;
    const active=this.active; this.active=undefined; await active?.close();
  }
  async disconnect() { const closing=this.cancel(); this.settings.disconnect(); await closing; }
  async close() { await this.cancel(); }
  connect(input:{email?:unknown;password?:unknown}) {
    if (typeof input.email!=='string' || input.email.length>254 || !/^\S+@\S+\.\S+$/.test(input.email.trim()) ||
      typeof input.password!=='string' || !input.password || input.password.length>1024)
      throw new AppError(400,'Enter your Zoom email and password.');
    if (this.active || this.transient?.status==='connecting') throw new AppError(409,'Finish or cancel the current Zoom connection first.');
    const email=input.email.trim(), generation=++this.generation;
    this.transient={status:'connecting',message:'Signing in to Zoom…',email};
    // The password is held only until form submission; never stored in service state.
    void this.openLogin(generation,email,input.password);
    return this.metadata();
  }
  private async openLogin(g:number,email:string,password:string) {
    let browser:LoginDriver|undefined;
    try {
      browser=await this.factory();
      if (g!==this.generation) { await browser.close(); return; }
      this.active=browser;
      this.deadline=setTimeout(()=>void this.fail(g,'Sign-in timed out. Connect again.'),this.timing.timeoutMs ?? 900000); this.deadline.unref();
      try { await browser.start(email,password); }
      catch { if(g===this.generation) this.transient={status:'action_required',message:'Complete sign-in in the browser, or cancel and correct your credentials.',email}; }
      password='';
      if(g===this.generation) await this.observe(g,email);
    } catch { password=''; await this.fail(g,'Could not open the Zoom sign-in browser. Try again.'); }
  }
  private async fail(g:number,message:string) {
    if(g!==this.generation)return;
    const email=this.transient?.email || '';
    const cancelledGeneration=this.generation+1;
    await this.cancel();
    if(this.generation===cancelledGeneration)this.transient={status:'error',message,email};
  }
  private async observe(g:number,email:string) {
    const browser=this.active; if(g!==this.generation || !browser)return;
    try {
      if(await browser.verify()) {
        const state=await browser.state();
        if(g!==this.generation)return;
        this.settings.save(email,state); await this.cancel(); return;
      }
      const problem=await browser.problem(); if(g!==this.generation)return;
      this.transient={status:'action_required',email,message:problem || 'Complete sign-in in the browser. Zoom may request a verification code or CAPTCHA.'};
      this.timer=setTimeout(()=>void this.observe(g,email),this.timing.pollMs ?? 3000); this.timer.unref();
    } catch { await this.fail(g,'The Zoom sign-in browser closed or became unavailable. Connect again.'); }
  }
  check() {
    if(this.active || this.transient?.status==='connecting')throw new AppError(409,'Finish or cancel sign-in first.');
    const state=this.settings.session(); if(!state)throw new AppError(409,'Connect a Zoom account first.');
    const g=++this.generation, email=this.settings.metadata().email;
    this.checking=true; this.transient={status:'connecting',email,message:'Checking your Zoom session…'};
    void (async()=>{
      let browser:LoginDriver|undefined;
      try {
        browser=await this.factory(state);
        if(g!==this.generation)return;
        this.active=browser;
        const valid=await browser.verify();
        const refreshed=valid ? await browser.state() : undefined;
        if(g!==this.generation)return;
        if(refreshed)this.settings.save(email,refreshed); else this.settings.markExpired();
        await this.cancel();
      } catch { await this.fail(g,'Could not check Zoom. Try again when the connection is available.'); }
      finally { await browser?.close().catch(()=>{}); }
    })();
    return this.metadata();
  }
  private browser() {
    if(!this.active || this.checking)throw new AppError(409,'No active Zoom sign-in browser.');
    return this.active;
  }
  async frame() {
    const browser=this.browser();
    if(this.busy)throw new AppError(409,'Browser is busy.');
    this.busy=true;
    try { const frame=await browser.frame(); if(frame.length>3_000_000)throw new AppError(413,'Browser image is too large.'); return frame; }
    catch(error) { if(browser!==this.active)throw new AppError(409,'No active Zoom sign-in browser.'); throw error; }
    finally {this.busy=false;}
  }
  async input(action:unknown) {
    const a=action as BrowserInput;
    if(!a || (a.type==='click' ? !Number.isFinite(a.x)||!Number.isFinite(a.y)||a.x<0||a.y<0||a.x>=1280||a.y>=900 :
      a.type==='text' ? typeof a.text!=='string'||!a.text||a.text.length>4096 :
      a.type==='key' ? typeof a.key!=='string'||!(/^(Tab|Shift\+Tab|Enter|Escape|Backspace|Delete|Arrow(Left|Right|Up|Down)|Home|End|Space|ControlOrMeta\+[acvx])$/.test(a.key)) :
      a.type==='scroll' ? !Number.isFinite(a.deltaY)||Math.abs(a.deltaY)>2000 : true)) throw new AppError(400,'Invalid browser input.');
    const browser=this.browser();
    const job=this.operations.then(()=>{if(browser!==this.active)throw new AppError(409,'No active Zoom sign-in browser.');return browser.input(a);});
    this.operations=job.catch(()=>{}); await job;
  }
}
