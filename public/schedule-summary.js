const SummaryInstructions = (() => {
  const prompt = document.getElementById('schedule-prompt');
  const expanded = document.getElementById('expanded-summary-prompt');
  const dialog = document.getElementById('summary-prompt-dialog');
  const details = document.getElementById('schedule-summary');
  const expandButton = document.getElementById('schedule-prompt-expand');
  const exampleButton = document.getElementById('schedule-prompt-example');
  const feedback = document.getElementById('schedule-prompt-feedback');
  let contextVersion = 0;
  let providerVersion = 0;
  let exampleBusy = false;
  function update() {
    document.getElementById('schedule-summary-state').textContent = prompt.value.trim() ? 'Custom instructions' : 'Default instructions';
    document.getElementById('schedule-prompt-count').textContent = `${prompt.value.length.toLocaleString('en-US')} / 8,000 characters`;
  }
  function expandedCount() {
    document.getElementById('expanded-prompt-count').textContent = `${expanded.value.length.toLocaleString('en-US')} / 8,000 characters`;
  }
  function reset(value = '') {
    contextVersion++;
    providerVersion++;
    prompt.value = value;
    feedback.textContent = '';
    details.open = !!value.trim();
    if (dialog.open) dialog.close();
    update();
  }
  async function refreshProvider() {
    if (!details.open) return;
    const version = ++providerVersion;
    const status = document.getElementById('schedule-ai-provider');
    status.textContent = 'Loading saved AI provider…';
    try {
      const response = await fetch('/api/settings/ai');
      if (!response.ok) throw new Error();
      const settings = await response.json();
      if (version !== providerVersion) return;
      const provider = settings.provider;
      const options = settings.providers[provider];
      status.textContent = `Saved AI provider: ${provider === 'openai' ? 'OpenAI' : 'z.ai'} · ${options.model}${options.configured ? '' : ' · API key not configured'}.`;
    } catch {
      if (version === providerVersion) status.textContent = 'AI settings unavailable. You can still save meeting instructions.';
    }
  }
  details.addEventListener('toggle', refreshProvider);
  prompt.addEventListener('input', update);
  exampleButton.addEventListener('click', async () => {
    if (exampleBusy) return;
    if (prompt.value.trim() && !window.confirm('Replace your current instructions with the example?')) return;
    const version = contextVersion;
    const original = prompt.value;
    exampleBusy = true;
    exampleButton.disabled = true;
    feedback.textContent = 'Loading example…';
    try {
      const response = await fetch('/api/summary-instructions');
      if (!response.ok) throw new Error();
      const value = await response.json();
      if (typeof value.defaultPrompt !== 'string') throw new Error();
      if (version !== contextVersion) return;
      if (prompt.value !== original) {
        feedback.textContent = 'Your instructions changed while the example loaded. Click Insert example to try again.';
        return;
      }
      prompt.value = value.defaultPrompt;
      update(); feedback.textContent = ''; prompt.focus();
    } catch {
      if (version === contextVersion) feedback.textContent = 'Could not load the example. Your instructions were kept. Try again.';
    } finally {
      exampleBusy = false;
      exampleButton.disabled = document.getElementById('save-schedule').disabled;
    }
  });
  expandButton.addEventListener('click', () => {
    expanded.value = prompt.value; expandedCount(); dialog.showModal(); expanded.focus();
  });
  expanded.addEventListener('input', expandedCount);
  document.getElementById('apply-summary-prompt').addEventListener('click', () => {
    prompt.value = expanded.value; update(); dialog.close();
  });
  document.getElementById('cancel-summary-prompt').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { expanded.value = ''; expandButton.focus(); });
  return { reset, refreshProvider };
})();
