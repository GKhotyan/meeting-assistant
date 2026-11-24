(() => {
  const el = name => document.getElementById('ai-' + name);
  const names = { openai: 'OpenAI', zai: 'z.ai' };
  const suggestions = { openai: ['gpt-4.1','gpt-5'], zai: ['glm-5.3','glm-5.3-flash','glm-5.3-flashx','glm-5.2','glm-5.1','glm-5','glm-4.7','glm-4.7-flash','glm-4.7-flashx'] };
  let saved = null, loaded = false, busy = false;
  const field = (provider, name) => el(provider + '-' + name);
  function syncPreset() {
    const model = field('zai','model').value.trim();
    field('zai','preset').value = suggestions.zai.includes(model) ? model : '';
  }
  async function request(method = 'GET', body, suffix = '') {
    const response = await fetch('/api/settings/ai' + suffix, {
      method, headers: { 'Content-Type':'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not update AI settings.');
    return value;
  }
  function feedback(provider, message = '', error = false) {
    const target = provider ? field(provider,'feedback') : el('feedback');
    target.textContent = message; target.className = error ? 'error' : 'muted';
  }
  function mask(provider) {
    field(provider,'key').type = 'password'; field(provider,'toggle').textContent = 'Show key'; field(provider,'toggle').setAttribute('aria-pressed','false');
  }
  function controls() {
    el('provider').disabled = busy || !loaded; el('apply-provider').disabled = busy || !loaded;
    el('reload').disabled = busy;
    field('zai','preset').disabled = busy || !loaded;
    for (const provider of Object.keys(names)) {
      for (const name of ['key','toggle','model','effort','save']) field(provider,name).disabled = busy || !loaded;
      field(provider,'check').disabled = busy || !loaded || (!field(provider,'key').value.trim() && !saved?.providers[provider].configured);
      field(provider,'remove').disabled = busy || !loaded || !saved?.providers[provider].configured;
    }
  }
  function status() {
    el('active').textContent = 'Active summary provider: ' + names[saved.provider] + '. Applies to new summary jobs.';
    for (const provider of Object.keys(names)) field(provider,'status').textContent =
      (saved.provider === provider ? 'Active for summaries. ' : '') + (saved.providers[provider].configured ? 'API key saved. Connection has not been checked.' : 'No API key saved.');
  }
  async function load() {
    busy = true; controls(); feedback(null);
    try {
      const value = await request(); saved = value; loaded = true;
      el('provider').value = saved.provider;
      for (const provider of Object.keys(names)) {
        field(provider,'model').value = saved.providers[provider].model;
        field(provider,'effort').value = saved.providers[provider].effort;
        field(provider,'key').value = ''; mask(provider); feedback(provider);
      }
      syncPreset(); status(); el('reload').hidden = true;
    } catch(error) {
      loaded = false; el('active').textContent = 'AI settings unavailable.'; feedback(null,error.message,true); el('reload').hidden = false;
    } finally { busy = false; controls(); }
  }
  async function act(provider, action) {
    if (busy || !loaded) return;
    const apiKey = field(provider,'key').value;
    busy = true; controls(); feedback(provider,action === 'check' ? 'Checking connection…' : 'Saving…');
    try {
      const value = await request(action === 'save' ? 'PUT' : action === 'remove' ? 'DELETE' : 'POST',
        { provider, ...(action === 'save' ? { model:field(provider,'model').value.trim(), effort:field(provider,'effort').value, activate:false } : {}),
          ...(action !== 'remove' && apiKey ? { apiKey } : {}) }, action === 'check' ? '/check' : '');
      if (action === 'check') {
        feedback(provider,(apiKey ? 'Entered key: ' : 'Saved key: ') + value.message,!value.valid);
        if (value.valid && !apiKey) field(provider,'status').textContent = (saved.provider === provider ? 'Active for summaries. ' : '') + 'API key saved. Connection verified.';
      } else {
        saved = value; field(provider,'key').value = ''; mask(provider);
        if (action === 'save') { field(provider,'model').value = saved.providers[provider].model; field(provider,'effort').value = saved.providers[provider].effort; }
        syncPreset(); status(); feedback(provider,action === 'save' ? 'Settings saved. Summary provider unchanged.' : 'API key removed. Model preferences were kept.');
      }
    } catch(error) { feedback(provider,error.message,true); }
    finally { busy = false; controls(); }
  }
  for (const provider of Object.keys(names)) {
    field(provider,'models').replaceChildren(...suggestions[provider].map(value => { const option = document.createElement('option'); option.value = value; return option; }));
    field(provider,'effort').replaceChildren(...(provider === 'zai' ? ['default','low','high','max'] : ['default','low','medium','high']).map(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value === 'default' ? 'Model default' : value[0].toUpperCase() + value.slice(1); return option;
    }));
    field(provider,'form').addEventListener('submit',event => { event.preventDefault(); void act(provider,'save'); });
    field(provider,'check').addEventListener('click',() => { void act(provider,'check'); });
    field(provider,'remove').addEventListener('click',() => { void act(provider,'remove'); });
    for (const name of ['key','model','effort']) field(provider,name).addEventListener('input',() => { feedback(provider); controls(); if (loaded) field(provider,'status').textContent = (saved.providers[provider].configured ? 'API key saved. ' : 'No API key saved. ') + 'Unsaved changes.'; });
    field(provider,'toggle').addEventListener('click',() => {
      const show = field(provider,'key').type === 'password'; field(provider,'key').type = show ? 'text' : 'password';
      field(provider,'toggle').textContent = show ? 'Hide key' : 'Show key'; field(provider,'toggle').setAttribute('aria-pressed',String(show));
    });
  }
  field('zai','preset').replaceChildren(...['',...suggestions.zai].map(value => {
    const option = document.createElement('option'); option.value = value; option.textContent = value || 'Custom model ID'; return option;
  }));
  field('zai','preset').addEventListener('change',() => {
    const model = field('zai','model');
    if (field('zai','preset').value) { model.value = field('zai','preset').value; model.dispatchEvent(new Event('input')); }
    else { model.focus(); model.select(); }
  });
  field('zai','model').addEventListener('input',syncPreset);
  el('provider-form').addEventListener('submit',async event => {
    event.preventDefault(); if (busy || !loaded) return;
    const provider = el('provider').value; busy = true; controls(); feedback(null,'Applying provider…');
    try { saved = await request('PUT',{provider},'/provider'); status(); feedback(null,'Summary provider updated. Both provider configurations were kept.'); }
    catch(error) { feedback(null,error.message,true); }
    finally { busy = false; controls(); }
  });
  el('reload').addEventListener('click',load);
  void load();
})();
