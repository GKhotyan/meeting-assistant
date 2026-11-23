(() => {
  const el=id=>document.getElementById(id), base='/api/settings/zoom';
  const dialog=el('zoom-browser'), image=el('zoom-browser-image');
  let state, pending=false, polling=false, imageUrl, frameBusy=false, stopped=false, emailDirty=false;
  el('zoom-email').addEventListener('input',()=>{emailDirty=true;});
  let inputQueue=Promise.resolve();
  async function request(path='',method='GET',data) {
    const r=await fetch(base+path,{method,headers:method==='GET'?{}:{'Content-Type':'application/json'},...(data!==undefined?{body:JSON.stringify(data)}:{})});
    if(!r.ok){const e=await r.json().catch(()=>({}));throw Error(e.error || 'Zoom connection unavailable.');}
    return r.json();
  }
  const names={not_connected:'Not connected',connecting:'Connecting…',action_required:'Action required',connected:'Connected',sign_in_required:'Sign-in required',error:'Connection failed'};
  function render(value) {
    state=value;
    if(!emailDirty)el('zoom-email').value=value.email || '';
    el('zoom-status').textContent=(names[value.status] || 'Unavailable')+(value.email?' · '+value.email:'');
    el('zoom-feedback').textContent=value.message || (value.status==='connected'?'Session verified. Meeting admission remains controlled by Zoom.':'');
    const active=['connecting','action_required'].includes(value.status);
    el('zoom-connect').disabled=pending || active;
    el('zoom-connect').textContent=['connected','sign_in_required'].includes(value.status)?'Reconnect':'Connect';
    el('zoom-check').hidden=value.status!=='connected';
    el('zoom-disconnect').hidden=!value.email || active;
    el('zoom-cancel').hidden=!active;
    el('zoom-browser-open').hidden=!value.browserAvailable;
    for(const id of ['zoom-email','zoom-password'])el(id).disabled=pending || active;
    for(const id of ['zoom-check','zoom-disconnect','zoom-cancel'])el(id).disabled=pending;
    el('zoom-reload').hidden=true;
    if(!value.browserAvailable && dialog.open)dialog.close();
  }
  async function load() {
    if(polling || pending)return; polling=true;
    try{render(await request());}catch(e){el('zoom-feedback').textContent=e.message;el('zoom-reload').hidden=false;}
    finally{polling=false;}
  }
  async function action(path,method='POST',data={}) {
    if(pending)return;pending=true;
    if(state)render(state);
    try{render(await request(path,method,data));}catch(e){el('zoom-feedback').textContent=e.message;}
    finally{pending=false;if(state)render({...state,message:el('zoom-feedback').textContent});}
  }
  el('zoom-form').addEventListener('submit',event=>{
    event.preventDefault();const email=el('zoom-email').value.trim(),password=el('zoom-password').value;
    el('zoom-password').value='';void action('/connect','POST',{email,password});
  });
  el('zoom-check').onclick=()=>void action('/check');
  el('zoom-disconnect').onclick=()=>void action('','DELETE');
  el('zoom-cancel').onclick=()=>void action('/cancel');
  el('zoom-reload').onclick=()=>void load();
  el('zoom-browser-open').onclick=()=>{dialog.showModal();void frame();};
  el('zoom-browser-close').onclick=()=>dialog.close();
  dialog.addEventListener('close',()=>{if(imageUrl){URL.revokeObjectURL(imageUrl);imageUrl=undefined;}image.removeAttribute('src');el('zoom-browser-text').value='';});
  async function frame() {
    if(!dialog.open || document.hidden || frameBusy || !state?.browserAvailable)return;
    frameBusy=true;
    try{
      const r=await fetch(base+'/browser/frame');if(!r.ok)throw Error('Browser image unavailable. Try again or reconnect.');
      const url=URL.createObjectURL(await r.blob());const old=imageUrl;image.src=url;imageUrl=url;if(old)URL.revokeObjectURL(old);
    }catch(e){el('zoom-browser-feedback').textContent=e.message;}finally{frameBusy=false;}
  }
  function input(value) {
    inputQueue=inputQueue.then(()=>request('/browser/input','POST',value)).then(()=>{el('zoom-browser-feedback').textContent='';void frame();}).catch(e=>{el('zoom-browser-feedback').textContent=e.message;});
  }
  image.addEventListener('click',event=>{image.focus();const r=image.getBoundingClientRect();input({type:'click',x:Math.min(1279,Math.floor((event.clientX-r.left)*1280/r.width)),y:Math.min(899,Math.floor((event.clientY-r.top)*900/r.height))});});
  image.addEventListener('keydown',event=>{
    const key=event.key===' '?'Space':event.key;
    if(key==='Escape')return;
    if(event.ctrlKey || event.metaKey){if(['a','c','x'].includes(key)){event.preventDefault();input({type:'key',key:'ControlOrMeta+'+key});}return;}
    if(key==='Tab' && event.shiftKey){event.preventDefault();input({type:'key',key:'Shift+Tab'});}
    else if(['Tab','Enter','Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','Space'].includes(key)){event.preventDefault();input({type:'key',key});}
    else if(key.length===1){event.preventDefault();input({type:'text',text:key});}
  });
  image.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text');if(text){event.preventDefault();input({type:'text',text:text.slice(0,4096)});}});
  image.addEventListener('wheel',event=>{event.preventDefault();input({type:'scroll',deltaY:Math.max(-2000,Math.min(2000,event.deltaY))});},{passive:false});
  el('zoom-browser-send').onclick=()=>{const text=el('zoom-browser-text').value;el('zoom-browser-text').value='';if(text){input({type:'key',key:'ControlOrMeta+a'});input({type:'text',text});}};
  el('zoom-browser-clear').onclick=()=>{el('zoom-browser-text').value='';input({type:'key',key:'ControlOrMeta+a'});input({type:'key',key:'Backspace'});};
  const refresh=setInterval(()=>{if(!stopped && !document.hidden){void load();void frame();}},1200);
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(refresh);if(imageUrl)URL.revokeObjectURL(imageUrl);});
  void load();
})();
