(() => {
  const field = id => document.getElementById('ai-' + id);
  const names = { openai: 'OpenAI', zai: 'z.ai' };
  const suggestions = { openai: ['gpt-4.1', 'gpt-5'], zai: ['glm-4.7', 'glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx', 'glm-4.7-flash'] };
  let saved, drafts, busy = false, loaded = false, provider = 'zai';

  async function request(method = 'GET', body, suffix = '') {
    const response = await fetch('/api/settings/ai' + suffix, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error || 'Could not update AI settings.');
    return value;
  }
  function controls() {
    for (const id of ['provider', 'key', 'toggle', 'model', 'effort', 'save']) field(id).disabled = busy || !loaded;
    field('check').disabled = busy || !loaded || (!field('key').value.trim() && !saved?.providers[provider].configured);
    field('remove').disabled = busy || !loaded || !saved?.providers[provider].configured;
    field('reload').disabled = busy;
  }
  function mask() {
    field('key').type = 'password';
    field('toggle').textContent = 'Show key';
    field('toggle').setAttribute('aria-pressed', 'false');
  }
  function remember() {
    if (!loaded) return;
    drafts[provider] = { model: field('model').value, effort: field('effort').value, apiKey: field('key').value };
  }
  function status() {
    field('status').textContent = saved.providers[provider].configured ? `${names[provider]} key saved. Connection has not been checked.` : `No ${names[provider]} key saved.`;
    field('active').textContent = `Saved provider: ${names[saved.provider]}. Save AI settings to apply your selection.`;
  }
  function render() {
    const draft = drafts[provider];
    field('provider').value = provider;
    field('model').value = draft.model;
    field('key').value = draft.apiKey;
    field('models').replaceChildren(...suggestions[provider].map(value => {
      const option = document.createElement('option'); option.value = value; return option;
    }));
    field('effort').replaceChildren(...(provider === 'zai' ? ['default', 'low', 'high', 'max'] : ['default', 'low', 'medium', 'high']).map(value => {
      const option = document.createElement('option'); option.value = value; option.textContent = value === 'default' ? 'Model default' : value[0].toUpperCase() + value.slice(1); return option;
    }));
    field('effort').value = draft.effort;
    field('key-link').href = provider === 'zai' ? 'https://z.ai/manage-apikey/apikey-list' : 'https://platform.openai.com/api-keys';
    field('key-link').textContent = `Get ${provider === 'openai' ? 'an' : 'a'} ${names[provider]} API key`;
    mask(); status(); controls();
  }
  function feedback(message = '', error = false) {
    field('feedback').textContent = message;
    field('feedback').className = error ? 'error' : '';
  }
  async function load() {
    busy = true; controls(); feedback();
    try {
      saved = await request();
      drafts = Object.fromEntries(Object.entries(saved.providers).map(([key, value]) => [key, { ...value, apiKey: '' }]));
      provider = saved.provider; loaded = true; render(); field('reload').hidden = true;
    } catch (error) {
      field('active').textContent = 'AI settings unavailable.';
      feedback(error.message, true); field('reload').hidden = false;
    } finally { busy = false; controls(); }
  }
  field('provider').addEventListener('change', () => {
    remember(); provider = field('provider').value; feedback(); render();
  });
  for (const id of ['key', 'model', 'effort']) field(id).addEventListener('input', () => {
    remember(); feedback(); if (loaded) status(); controls();
  });
  field('toggle').addEventListener('click', () => {
    const show = field('key').type === 'password'; field('key').type = show ? 'text' : 'password';
    field('toggle').textContent = show ? 'Hide key' : 'Show key'; field('toggle').setAttribute('aria-pressed', String(show));
  });
  async function act(action) {
    if (busy || !loaded) return;
    remember(); busy = true; controls(); status(); feedback(action === 'check' ? 'Checking connection…' : 'Saving…');
    try {
      const draft = drafts[provider];
      const value = await request(action === 'save' ? 'PUT' : action === 'remove' ? 'DELETE' : 'POST',
        { provider, ...(action === 'save' ? { model: draft.model.trim(), effort: draft.effort } : {}), ...(action !== 'remove' && draft.apiKey ? { apiKey: draft.apiKey } : {}) }, action === 'check' ? '/check' : '');
      if (action === 'check') {
        feedback((draft.apiKey ? 'Entered key: ' : 'Saved key: ') + value.message, !value.valid);
        if (value.valid && !draft.apiKey) field('status').textContent = `${names[provider]} key saved. Connection verified.`;
      } else {
        saved = value;
        if (action === 'save') drafts[provider] = { ...saved.providers[provider], apiKey: '' };
        else drafts[provider].apiKey = '';
        render(); feedback(action === 'save' ? 'Settings saved. Connection has not been checked.' : 'API key removed. Model preferences were kept.');
      }
    } catch (error) { feedback(error.message, true); }
    finally { busy = false; controls(); }
  }
  field('form').addEventListener('submit', event => { event.preventDefault(); act('save'); });
  field('check').addEventListener('click', () => act('check'));
  field('remove').addEventListener('click', () => act('remove'));
  field('reload').addEventListener('click', load);
  load();
})();
