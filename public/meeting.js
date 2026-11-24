/* Dedicated meeting view; hash links keep navigation shareable without a router dependency. */
window.MeetingView = (() => {
  let id = null, tab = 'recording', generation = 0, session = null;
  let state = null, configured = false, submitting = false, loaded = false;
  let resultKey = null, fileKey = null, requestNumber = 0, pendingRefresh = null, pendingSeek = null;
  const element = id => document.getElementById(id);
  const endpoint = () => '/api/sessions/' + encodeURIComponent(id);
  const fileUrl = (sessionId, fileId) => '/api/sessions/' + encodeURIComponent(sessionId) + '/files/' + encodeURIComponent(fileId);
  const time = seconds => {
    const whole = Math.max(0, Math.floor(seconds));
    const hours = Math.floor(whole / 3600);
    return (hours ? hours + ':' : '') + String(Math.floor(whole / 60) % 60).padStart(2,'0') + ':' + String(whole % 60).padStart(2,'0');
  };
  function cancelSeek() {
    if (pendingSeek) element('meeting-audio').removeEventListener('loadedmetadata', pendingSeek);
    pendingSeek = null;
  }
  function player(fileId) {
    const audio = element('meeting-audio');
    const file = session?.files.find(file => file.id === fileId && file.kind === 'audio' && file.status === 'ready');
    element('meeting-player').hidden = !file;
    const source = file ? fileUrl(id, file.id) + '?play=1' : '';
    if ((audio.getAttribute('src') || '') !== source) {
      cancelSeek();
      audio.pause();
      if (source) audio.src = source;
      else audio.removeAttribute('src');
      audio.load();
    }
  }
  function close() {
    cancelSeek();
    if (id) { element('meeting-audio').pause(); element('meeting-audio').removeAttribute('src'); element('meeting-audio').load(); }
    MeetingSummary.close();
    id = null; generation++; requestNumber++; pendingRefresh = null;
  }
  function selectTab(next) {
    tab = next;
    for (const name of ['recording','transcription','summary']) {
      const selected = name === tab;
      element('meeting-tab-' + name).setAttribute('aria-selected', String(selected));
      element('meeting-tab-' + name).tabIndex = selected ? 0 : -1;
      element('meeting-panel-' + name).hidden = !selected;
    }

  }
  function render() {
    if (!id || !session) return;
    element('page-title').textContent = session.meetingName || 'Meeting';
    element('page-description').textContent = 'Recording, transcript and summary, together.';
    element('meeting-meta').textContent = new Date(session.createdAt).toLocaleString('en-US') + ' · ' + session.botName + ' · ' + (labels[session.status] || session.status);
    const files = session.files.filter(file => file.status === 'ready');
    const key = JSON.stringify(files);
    if (key !== fileKey) {
      fileKey = key;
      const selected = element('transcription-file').value;
      element('transcription-file').replaceChildren();
      element('meeting-files').replaceChildren();
      for (const file of files) {
        const link = document.createElement('a');
        link.className = 'download'; link.href = fileUrl(id,file.id);
        link.textContent = '↓ ' + file.name + ' · ' + (file.bytes/1024/1024).toFixed(1) + ' MB';
        element('meeting-files').append(link);
        if (file.kind === 'audio') {
          const option = document.createElement('option'); option.value = file.id; option.textContent = file.name;
          element('transcription-file').append(option);
        }
      }
      if ([...element('transcription-file').options].some(option => option.value === selected)) element('transcription-file').value = selected;
      if (!files.length) element('meeting-files').textContent = 'No finalized files yet. Wait for the recording to finish.';
    }
    const running = submitting || state?.status === 'processing';
    const locked = running || MeetingSummary.isRunning();
    const available = session.status === 'completed' && !!element('transcription-file').value;
    for (const name of ['file','language','diarize']) element('transcription-' + name).disabled = !loaded || locked || !available;
    element('transcription-submit').disabled = !loaded || locked || !available || !configured;
    element('transcription-submit').textContent = running ? 'Transcribing…' : ['failed','interrupted'].includes(state?.status) ? 'Retry transcription' : state?.transcript ? 'Transcribe again' : 'Get transcription';
    element('transcription-settings').hidden = !loaded || configured;
    const status = element('transcription-status');
    status.className = ['failed','interrupted'].includes(state?.status) ? 'error' : 'muted';
    status.textContent = !loaded ? 'Loading transcription…' : state?.status === 'processing' ? 'Transcribing audio…' : state?.error || (!available ? 'Transcription is available after recording completes with a finalized audio file.' : !configured ? 'Save a Deepgram API key in Settings to transcribe this meeting.' : state?.status === 'completed' ? 'Transcript ready.' : 'No transcription yet.');
    const transcript = state?.transcript;
    const nextKey = JSON.stringify(transcript || null);
    if (nextKey !== resultKey) {
      resultKey = nextKey;
      const result = element('transcript-result'); result.replaceChildren();
      if (transcript) {
        const meta = document.createElement('p'); meta.className = 'muted';
        meta.textContent = transcript.audioFile + ' · ' + transcript.language + ' · ' + transcript.model + ' · ' + new Date(transcript.createdAt).toLocaleString('en-US');
        result.append(meta);
        if (state.status !== 'completed') {
          const prior = document.createElement('p'); prior.className = 'muted'; prior.textContent = 'Previous successful transcript'; result.append(prior);
        }
        if (transcript.segments?.length) {
          for (const segment of transcript.segments) {
            const row = document.createElement('div'); row.className = 'transcript-segment';
            const timestamp = document.createElement('button'); timestamp.type = 'button'; timestamp.className = 'timestamp'; timestamp.textContent = time(segment.start);
            timestamp.setAttribute('aria-label','Play from ' + time(segment.start));
            timestamp.addEventListener('click', () => {
              player(transcript.audioFileId);
              const audio = element('meeting-audio');
              const current = generation, meetingId = id, source = audio.getAttribute('src');
              const seek = () => {
                cancelSeek();
                if (current !== generation || meetingId !== id || audio.getAttribute('src') !== source) return;
                audio.currentTime = segment.start; audio.play().catch(() => {});
              };
              cancelSeek();
              if (audio.readyState >= 1) seek();
              else { pendingSeek = seek; audio.addEventListener('loadedmetadata', seek, { once:true }); }
            });
            const copy = document.createElement('div');
            if (Number.isInteger(segment.speaker)) {
              const speaker = document.createElement('strong'); speaker.className = 'speaker'; speaker.textContent = 'Speaker ' + (segment.speaker + 1); copy.append(speaker);
            }
            const text = document.createElement('p'); text.textContent = segment.text; copy.append(text); row.append(timestamp,copy);result.append(row);
          }
        } else {
          const text = document.createElement('p'); text.className = 'transcript-text'; text.textContent = transcript.text || 'No speech was detected in this audio.'; result.append(text);
        }
      }
    }
    MeetingSummary.update(session, state);
    selectTab(tab);
    if (!element('meeting-audio').getAttribute('src')) player(element('transcription-file').value);
  }
  function refresh() {
    if (!id) return Promise.resolve();
    if (pendingRefresh) return pendingRefresh;
    const pending = Promise.all([load(), MeetingSummary.refresh()]);
    pendingRefresh = pending;
    pending.finally(() => { if (pendingRefresh === pending) pendingRefresh = null; });
    return pending;
  }
  async function load() {
    const current = generation, meetingId = id, request = ++requestNumber;
    try {
      const [meeting, transcription, settings] = await Promise.all([api(endpoint()),api(endpoint() + '/transcription'),api('/api/settings/deepgram')]);
      if (current !== generation || meetingId !== id || request !== requestNumber) return;
      const first = !loaded;
      session = meeting; state = transcription; configured = settings.configured; loaded = true;
      if (first && state.options) {
        element('transcription-language').value = state.options.language;
        element('transcription-diarize').checked = state.options.diarize;
      }
      element('meeting-error').textContent = session.nameWarning || '';
      render();
      if (first && state.options?.audioFileId && [...element('transcription-file').options].some(option => option.value === state.options.audioFileId)) {
        element('transcription-file').value = state.options.audioFileId; player(state.options.audioFileId);
      }
    } catch (error) {
      if (current !== generation || request !== requestNumber) return;
      element('meeting-error').textContent = error.message;
      if (!loaded) element('transcription-status').textContent = 'Could not load transcription. Reopen this meeting to try again.';
    }
  }
  function route() {
    const match = /^#meeting\/([a-zA-Z0-9-]+)\/(recording|transcription|summary)$/.exec(location.hash);
    if (!match) { switchTab(location.hash === '#settings' ? 'settings' : 'now'); return; }
    const changed = id !== match[1];
    if (changed) {
      close(); id = match[1]; MeetingSummary.open(id, render); session = null; state = null; loaded = false; configured = false; submitting = false; resultKey = null; fileKey = null;
      element('page-title').textContent = 'Loading meeting…'; element('page-description').textContent = '';
      element('meeting-meta').textContent = ''; element('meeting-error').textContent = '';
      element('meeting-files').replaceChildren(); element('transcript-result').replaceChildren();
      element('transcription-file').replaceChildren(); element('transcription-language').value = 'ru'; element('transcription-diarize').checked = false;
      element('transcription-feedback').textContent = ''; element('transcription-status').textContent = 'Loading transcription…';
      element('transcription-submit').disabled = true; element('meeting-player').hidden = true;
    }
    for (const name of ['now','schedule','settings']) element('panel-' + name).hidden = true;
    element('tab-now').setAttribute('aria-selected','true');
    element('tab-now').tabIndex = 0;
    for (const name of ['schedule','settings']) { element('tab-' + name).setAttribute('aria-selected','false'); element('tab-' + name).tabIndex = -1; }
    element('panel-meeting').hidden = false;
    selectTab(match[2]);
    if (changed) { element('page-title').focus(); void refresh(); }
  }
  function init() {
    MeetingSummary.init();
    for (const name of ['recording','transcription','summary']) {
      element('meeting-tab-' + name).addEventListener('click', () => { if (id) location.hash = 'meeting/' + id + '/' + name; });
      element('meeting-tab-' + name).addEventListener('keydown', event => {
        if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
        event.preventDefault(); const target = event.key === 'Home' ? 'recording' : event.key === 'End' ? 'summary' : ['recording','transcription','summary'][(['recording','transcription','summary'].indexOf(name) + (event.key === 'ArrowLeft' ? 2 : 1)) % 3];
        location.hash = 'meeting/' + id + '/' + target; element('meeting-tab-' + target).focus();
      });
    }
    element('transcription-file').addEventListener('change',()=>player(element('transcription-file').value));
    element('transcription-form').addEventListener('submit',async event=>{
      event.preventDefault(); if (!id || submitting || element('transcription-submit').disabled) return;
      const current = generation, meetingId = id;
      requestNumber++; submitting = true; element('transcription-feedback').textContent = ''; render();
      try {
        const result = await api(endpoint() + '/transcription','POST',{audioFileId:element('transcription-file').value,language:element('transcription-language').value,diarize:element('transcription-diarize').checked});
        if (current !== generation || meetingId !== id) return;
        requestNumber++; state = result;
      } catch(error) {
        if (current !== generation || meetingId !== id) return;
        element('transcription-feedback').className = 'error'; element('transcription-feedback').textContent = error.message;
      } finally {
        if (current === generation && meetingId === id) { submitting = false; render(); }
      }
    });
    window.addEventListener('hashchange',route); route(); setInterval(refresh,2000);
  }
  return {init,route,refresh,close};
})();
