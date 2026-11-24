/* Summary lifecycle is independent of transcription loading and navigation. */
window.MeetingSummary = (() => {
  const el = name => document.getElementById('summary-' + name);
  let id = null, generation = 0, requestNumber = 0, pending = null, busy = false, loaded = false;
  let state = null, settings = null, meeting = null, transcription = null, resultKey = null, onChange = () => {};
  let editor = null, editorVersion = 0, editorSaving = false;
  const endpoint = () => '/api/sessions/' + encodeURIComponent(id) + '/summary';
  const providerName = provider => provider === 'openai' ? 'OpenAI' : 'z.ai';
  function close() {
    editorVersion++; editor = null; editorSaving = false;
    if (el('prompt-editor').open) el('prompt-editor').close();
    id = null; generation++; requestNumber++; pending = null; busy = false; loaded = false;
    state = null; settings = null; meeting = null; transcription = null; resultKey = null; onChange = () => {};
  }
  function open(next, callback) {
    close(); id = next; onChange = callback;
    el('feedback').textContent = ''; el('result').replaceChildren(); el('instructions-text').textContent = '';
    render();
  }
  function isRunning() { return busy || state?.status === 'processing'; }
  function update(session, transcript) { meeting = session; transcription = transcript; render(); }
  function inline(parent, text) {
    // Small Markdown subset; never interpret HTML, links or model-generated URLs.
    for (const part of text.split(/(\*\*[^*\n]+\*\*)/g)) {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        const strong = document.createElement('strong'); strong.textContent = part.slice(2,-2); parent.append(strong);
      } else parent.append(document.createTextNode(part));
    }
  }
  function showText(text) {
    const container = el('result'); container.replaceChildren();
    let list = null;
    for (const line of text.split('\n')) {
      const heading = /^(#{1,6})\s+(.+)$/.exec(line), bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bullet) {
        if (!list) { list = document.createElement('ul'); container.append(list); }
        const item = document.createElement('li'); inline(item,bullet[1]); list.append(item);
      } else {
        list = null;
        if (!line.trim()) continue;
        const block = document.createElement(heading ? 'h' + Math.min(4, heading[1].length + 1) : 'p');
        inline(block,heading ? heading[2] : line); container.append(block);
      }
    }
  }
  function render() {
    if (!id) return;
    const running = isRunning(), result = state?.result;
    const selected = settings?.providers[settings.provider];
    const ready = meeting?.status === 'completed' && transcription?.status === 'completed' && !!transcription.transcript?.text?.trim();
    el('submit').disabled = !loaded || running || !selected?.configured || !ready;
    el('submit').textContent = running ? 'Generating…' : result ? 'Generate again' : ['failed','interrupted'].includes(state?.status) ? 'Retry summary' : 'Generate summary';
    el('settings').hidden = !loaded || !!selected?.configured;
    el('provider').textContent = selected ? 'Saved provider: ' + providerName(settings.provider) + ' · ' + selected.model + ' · Reasoning: ' + (selected.effort === 'default' ? 'model default' : selected.effort) : '';
    const progress = state?.progress;
    el('status').className = ['failed','interrupted'].includes(state?.status) ? 'error' : 'muted';
    el('status').textContent = !loaded ? 'Loading summary…' : state?.status === 'processing' ?
      (progress ? { summarizing:'Summarizing transcript', extracting:'Extracting notes from ' + progress.parts + ' transcript parts', merging:'Merging ordered notes' }[progress.stage] + '… ' + progress.completedRequests + ' requests completed.' : 'Preparing summary…') :
      state?.error || (!ready ? 'Complete a nonempty transcription before generating a summary.' : !selected?.configured ? 'Save an API key for the selected AI provider in Settings.' : result ? 'Summary ready.' : 'No summary yet.');
    el('previous').hidden = !result || state.status === 'completed';
    el('stale').hidden = !result || !state.stale;
    el('stale').textContent = state?.instructionsChanged
      ? 'Summary instructions have changed. Generate again to use the current instructions. The saved summary still shows its original instructions below.'
      : 'The transcript has changed or is being replaced. This summary uses an earlier transcript. Generate again after transcription completes to update it.';
    const instructions = state?.instructions;
    el('instructions-origin').textContent = instructions ? 'Current instructions (prompt): ' + (instructions.promptOrigin === 'schedule' ? 'Schedule · ' + instructions.scheduleName : instructions.promptOrigin === 'recording' ? 'Recording snapshot' : 'Default instructions') : '';
    el('edit-prompt').hidden = !loaded || instructions?.promptOrigin !== 'schedule' || !instructions?.scheduleId;
    el('next-instructions').hidden = !instructions;
    if (instructions && el('next-prompt').textContent !== instructions.prompt) el('next-prompt').textContent = instructions.prompt;
    el('actions').hidden = !result;
    el('meta').hidden = !result;
    el('instructions').hidden = !result;
    if (result) {
      el('meta').textContent = providerName(result.provider) + ' · ' + result.model + ' · ' + new Date(result.createdAt).toLocaleString('en-US') + ' · ' + result.requests + (result.requests === 1 ? ' request' : ' requests') + (result.contextFallback ? ' · Conservative context limit for an unlisted model' : '');
      el('download').href = endpoint() + '/download';
      el('instructions-text').textContent = result.prompt;
    }
    const nextKey = result?.text || '';
    if (nextKey !== resultKey) { resultKey = nextKey; showText(nextKey); }
  }
  async function load() {
    const current = generation, meetingId = id, request = ++requestNumber, path = endpoint();
    try {
      const [summary, ai] = await Promise.all([api(path),api('/api/settings/ai')]);
      if (current !== generation || meetingId !== id || request !== requestNumber) return;
      if (state && (state.status !== summary.status || state.result?.createdAt !== summary.result?.createdAt)) el('feedback').textContent = '';
      state = summary; settings = ai; loaded = true; render(); onChange();
    } catch(error) {
      if (current !== generation || meetingId !== id || request !== requestNumber) return;
      el('feedback').className = 'error'; el('feedback').textContent = error.message;
      if (!loaded) el('status').textContent = 'Could not load summary. Retrying automatically…';
    }
  }
  function refresh() {
    if (!id || busy) return Promise.resolve();
    if (pending) return pending;
    const promise = load(); pending = promise;
    promise.finally(() => { if (pending === promise) pending = null; });
    return promise;
  }
  function init() {
    el('edit-prompt').addEventListener('click', async () => {
      const instructions = state?.instructions;
      if (!id || !instructions?.scheduleId || instructions.promptOrigin !== 'schedule') return;
      const version = ++editorVersion, meetingId = id;
      editor = null; editorSaving = false;
      el('prompt-draft').value = ''; el('prompt-draft').disabled = true;
      el('prompt-save').disabled = true; el('prompt-save').textContent = 'Save shared prompt'; el('prompt-cancel').disabled = false;
      el('prompt-error').textContent = ''; el('prompt-count').textContent = 'Loading saved prompt…';
      el('prompt-warning').textContent = 'These instructions (prompt) are shared by all recordings linked to “' + instructions.scheduleName + '”. Saving changes the instructions for future summary generations for all meetings of this type, including existing recordings.';
      el('prompt-editor').showModal();
      try {
        const value = await api('/api/schedules');
        if (version !== editorVersion || id !== meetingId || !el('prompt-editor').open) return;
        const rule = value.schedules.find(rule => rule.id === instructions.scheduleId);
        if (!rule) throw new Error('This recurring meeting was removed. Close the editor and reload the summary.');
        editor = { scheduleId: rule.id, expectedSummaryPrompt: rule.summaryPrompt || '' };
        el('prompt-draft').value = editor.expectedSummaryPrompt; el('prompt-draft').disabled = false; el('prompt-save').disabled = false;
        el('prompt-count').textContent = el('prompt-draft').value.length.toLocaleString('en-US') + ' / 8,000 characters';
        el('prompt-draft').focus();
      } catch (error) { if (version === editorVersion && id === meetingId) el('prompt-error').textContent = error.message; }
    });
    el('prompt-draft').addEventListener('input', () => {
      el('prompt-count').textContent = el('prompt-draft').value.length.toLocaleString('en-US') + ' / 8,000 characters';
    });
    el('prompt-editor').addEventListener('cancel', event => { if (editorSaving) event.preventDefault(); });
    el('prompt-editor').addEventListener('close', () => { editorVersion++; editor = null; });
    el('prompt-cancel').addEventListener('click', () => { if (!editorSaving) el('prompt-editor').close(); });
    el('prompt-editor-form').addEventListener('submit', async event => {
      event.preventDefault(); if (!editor || editorSaving) return;
      const version = editorVersion, meetingId = id, target = { ...editor };
      editorSaving = true; el('prompt-save').disabled = true; el('prompt-cancel').disabled = true; el('prompt-draft').disabled = true;
      el('prompt-save').textContent = 'Saving…'; el('prompt-error').textContent = '';
      try {
        await api('/api/schedules/' + encodeURIComponent(target.scheduleId), 'PUT', { summaryPrompt: el('prompt-draft').value, expectedSummaryPrompt: target.expectedSummaryPrompt });
        if (version !== editorVersion || id !== meetingId) return;
        editorSaving = false; el('prompt-editor').close();
        el('feedback').className = 'muted'; el('feedback').textContent = 'Shared instructions (prompt) saved for this meeting type. Generate again to update an existing summary.';
        await refresh();
      } catch (error) { if (version === editorVersion && id === meetingId) el('prompt-error').textContent = error.message; }
      finally {
        if (version === editorVersion && id === meetingId) {
          editorSaving = false; el('prompt-save').disabled = false; el('prompt-cancel').disabled = false; el('prompt-draft').disabled = false; el('prompt-save').textContent = 'Save shared prompt';
        }
      }
    });
    el('submit').addEventListener('click', async () => {
      if (!id || isRunning() || el('submit').disabled) return;
      const regenerate = !!state?.result;
      if (regenerate && !window.confirm('Generate a new summary? This sends the current transcript and current summary instructions to your AI provider. Linked recordings use the latest instructions saved in Schedule. Provider charges may apply. The previous summary is kept if generation fails.')) return;
      const current = generation, meetingId = id, path = endpoint();
      requestNumber++; pending = null; busy = true; el('feedback').textContent = ''; render(); onChange();
      try {
        const value = await api(path,'POST',regenerate ? { regenerate:true } : {});
        if (current !== generation || meetingId !== id) return;
        requestNumber++; state = value;
      } catch(error) {
        if (current !== generation || meetingId !== id) return;
        el('feedback').className = 'error'; el('feedback').textContent = error.message;
      } finally {
        if (current === generation && meetingId === id) { busy = false; render(); onChange(); }
      }
    });
    el('copy').addEventListener('click', async () => {
      if (!state?.result) return;
      const current = generation, text = state.result.text;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
        else {
          const textarea = document.createElement('textarea'); textarea.value = text; textarea.className = 'clipboard-buffer'; document.body.append(textarea); textarea.select();
          const copied = document.execCommand('copy'); textarea.remove(); el('copy').focus();
          if (!copied) throw Error();
        }
        if (current === generation) { el('feedback').className = 'muted'; el('feedback').textContent = 'Summary copied.'; }
      } catch {
        if (current === generation) { el('feedback').className = 'error'; el('feedback').textContent = 'Could not access the clipboard. Download Markdown or select the summary text to copy it.'; }
      }
    });
  }
  return { init, open, close, update, refresh, isRunning };
})();
