const $ = (id) => document.getElementById(id);
let activeId = null;
let latestSessions = [];
let activeSession = null;
let busy = false;
const deleting = new Set();
let schedules = [];
let editingScheduleId = null;
let scheduleBusy = false;
let renderedSessionsKey = null;
let renderedSchedulesKey = null;
let settingsQueue = Promise.resolve();
const settingsDirty = { drawer: false, settings: false };
const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const modeNames = { video: "Full video", screenshots: "Screenshots", audio: "Audio only" };
const labels = {
  queued: "Starting",
  joining: "Joining",
  waiting: "Waiting for admission",
  recording: "Recording",
  stopping: "Saving and leaving",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};
async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Request failed");
  return data;
}
function notice(text, error = false) {
  const inDrawer = $("record-dialog").open;
  $("notice").textContent = inDrawer ? "" : text;
  $("notice").className = error ? "error" : "";
  $("record-notice").textContent = inDrawer ? text : "";
  $("record-notice").hidden = !inDrawer || !text;
  $("record-notice").className = error ? "error" : "muted";
}
function duration(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  return (hours ? String(hours).padStart(2, "0") + ":" : "") + String(Math.floor(seconds / 60) % 60).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
}
function updateTimer() {
  if (activeSession) $("active-timer").textContent = duration(Date.now() - Date.parse(activeSession.createdAt));
}
function render(sessions) {
  latestSessions = sessions;
  activeSession = sessions.find(s => !["completed", "failed", "interrupted"].includes(s.status)) || null;
  $("active-session").hidden = !activeSession;
  if (activeSession) {
    $("active-name").textContent = activeSession.meetingName || "Meeting";
    $("active-status").textContent = labels[activeSession.status] || activeSession.status;
    updateTimer();
  }
  $("meeting-count").textContent = sessions.length;
  const query = $("meeting-search").value.trim().toLocaleLowerCase("en-US");
  const visibleSessions = sessions.filter(s => [s.meetingName || "Meeting", s.botName, s.id].join(" ").toLocaleLowerCase("en-US").includes(query));
  $("result-count").textContent = visibleSessions.length;
  activeId =
    sessions.find(
      (s) => !["completed", "failed", "interrupted"].includes(s.status),
    )?.id || null;
  $("start").disabled = busy || !!activeId;
  $("stop").disabled = busy || !activeId;
  const renderKey = JSON.stringify([sessions, [...deleting], query]);
  if (renderKey === renderedSessionsKey) return;
  const scrollPosition = { x: window.scrollX, y: window.scrollY };
  const screenshotState = new Map(
    [...$("sessions").querySelectorAll("details.screenshots")].map(details =>
      [details.dataset.sessionId, { open: details.open, scrollTop: details.querySelector(".screenshot-list").scrollTop }]),
  );
  // Build off the page so layout never sees a partly rebuilt meeting list.
  const content = document.createDocumentFragment();
  if (!visibleSessions.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    const symbol = document.createElement("span"), title = document.createElement("h3"), description = document.createElement("p");
    symbol.className = "empty-symbol";
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = "▤";
    title.textContent = query ? "No matching meetings" : "Your next conversation starts here";
    description.textContent = query ? "Try a different meeting name or clear your search." : "Record your first meeting. We'll keep the files ready for you here.";
    empty.append(symbol, title, description);
    content.append(empty);
  }
  for (const s of visibleSessions) {
    const card = document.createElement("article"),
      title = document.createElement("strong"),
      meta = document.createElement("p"),
      state = document.createElement("span");
    title.textContent = s.meetingName || "Meeting";
    state.textContent = labels[s.status] || s.status;
    state.className = "badge " + s.status;
    meta.className = "muted";
    meta.textContent =
      new Date(s.createdAt).toLocaleString("en-US") + " · " + s.botName + " · " + s.id.slice(0, 8);
    if (s.endedAt) meta.textContent += " · " + duration(Date.parse(s.endedAt) - Date.parse(s.createdAt)) + " elapsed";
    card.append(title, state, meta);
    if (s.error) {
      const error = document.createElement("p");
      error.textContent = s.error;
      error.className = "error";
      card.append(error);
    }
    function downloadLink(file) {
      const link = document.createElement("a");
      link.textContent =
        (file.kind === "audio" ? "↓ Audio" : file.kind === "screenshot" ? "↓ Screenshot " + new Date(file.startedAtMs).toLocaleTimeString("en-US") : "↓ Screen video") +
        " · " +
        (file.bytes / 1024 / 1024).toFixed(1) +
        " MB";
      link.href =
        "/api/sessions/" +
        encodeURIComponent(s.id) +
        "/files/" +
        encodeURIComponent(file.id);
      link.className = "download";
      return link;
    }
    const media = document.createElement("div");
    media.className = "recording-media";
    for (const kind of ["audio", "screen"]) {
      for (const file of s.files.filter(file => file.kind === kind)) {
        media.append(downloadLink(file));
      }
    }
    if (media.childElementCount) card.append(media);
    const shots = s.files.filter(file => file.kind === "screenshot");
    if (shots.length) {
      const details = document.createElement("details");
      details.className = "screenshots";
      details.dataset.sessionId = s.id;
      details.open = screenshotState.get(s.id)?.open || false;
      const summary = document.createElement("summary");
      summary.textContent = "Screenshots · " + shots.length;
      const list = document.createElement("div");
      list.className = "screenshot-list";
      for (const file of shots) list.append(downloadLink(file));
      details.append(summary, list);
      card.append(details);
    }
    if (["interrupted", "failed"].includes(s.status)) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent =
        "Available recording chunks and logs are saved in this session’s folder.";
      card.append(p);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-session";
    remove.textContent = deleting.has(s.id) ? "Deleting…" : "Delete recording";
    remove.disabled = deleting.has(s.id) || !["completed", "failed", "interrupted"].includes(s.status);
    remove.addEventListener("click", async () => {
      if (deleting.has(s.id)) return;
      if (!window.confirm("Permanently delete this meeting and all its audio, video, screenshots, and other files? This cannot be undone.")) return;
      deleting.add(s.id);
      remove.disabled = true;
      try {
        await api("/api/sessions/" + encodeURIComponent(s.id), "DELETE", {});
        notice("Meeting and all its files permanently deleted.");
      } catch (e) {
        notice(e.message, true);
      } finally {
        deleting.delete(s.id);
        await refresh();
      }
    });
    card.append(remove);
    content.append(card);
  }
  $("sessions").replaceChildren(content);
  for (const details of $("sessions").querySelectorAll("details.screenshots")) {
    details.querySelector(".screenshot-list").scrollTop = screenshotState.get(details.dataset.sessionId)?.scrollTop || 0;
  }
  window.scrollTo(scrollPosition.x, scrollPosition.y);
  renderedSessionsKey = renderKey;
}
async function refresh() {
  try {
    const [data, rules] = await Promise.all([api("/api/sessions"), api("/api/schedules")]);
    render(data.sessions);
    schedules = rules.schedules;
    renderSchedules();
    $("connection").textContent = "Connected";
    $("connection").dataset.connected = "true";
    $("schedule-count").textContent = schedules.filter(rule => rule.enabled).length;
  } catch (e) {
    $("connection").textContent = "Disconnected";
    $("connection").dataset.connected = "false";
  }
}

function switchTab(name) {
  const titles = { now: ["Meetings", "Every conversation, ready to revisit."], schedule: ["Schedule", "Make room for the conversations that matter."], settings: ["Settings", "Make your assistant feel like part of the team."] };
  $("page-title").textContent = titles[name][0];
  $("page-description").textContent = titles[name][1];
  for (const id of ["now", "schedule", "settings"]) {
    const selected = id === name;
    $("tab-" + id).setAttribute("aria-selected", String(selected));
    $("tab-" + id).tabIndex = selected ? 0 : -1;
    $("panel-" + id).hidden = !selected;
  }
}
for (const name of ["now", "schedule", "settings"]) {
  $("tab-" + name).addEventListener("click", () => switchTab(name));
  $("tab-" + name).addEventListener("keydown", event => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const tabs = ["now", "schedule", "settings"];
    const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 1;
    const target = event.key === "Home" ? "now" : event.key === "End" ? "settings" : tabs[(tabs.indexOf(name) + direction + tabs.length) % tabs.length];
    switchTab(target);
    $("tab-" + target).focus();
  });
}
function scheduleDate(value, zone) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(new Date(value));
}
function editSchedule(rule) {
  editingScheduleId = rule?.id || null;
  $("schedule-form").reset();
  $("schedule-name").value = rule?.name || "";
  $("schedule-url").value = rule?.meetingUrl || "";
  $("schedule-bot").value = rule?.botName ?? "Engineering Assistant";
  $("schedule-time").value = rule?.time || "10:00";
  $("schedule-zone").value = rule?.timeZone || "Europe/Moscow";
  $("schedule-mode").value = rule?.recordingMode || $("recordingMode").value || "video";
  for (const input of document.querySelectorAll('input[name="weekday"]')) {
    input.checked = (rule?.weekdays || []).includes(Number(input.value));
  }
  $("schedule-editor-title").textContent = rule ? "Edit recurring meeting" : "Add recurring meeting";
  $("schedule-form").hidden = false;
  $("add-schedule").hidden = true;
  $("schedule-name").focus();
}
function closeScheduleEditor() {
  editingScheduleId = null;
  $("schedule-form").hidden = true;
  $("add-schedule").hidden = false;
  $("schedule-form").reset();
}
async function changeSchedule(rule, method, body) {
  if (scheduleBusy) return;
  scheduleBusy = true;
  renderSchedules();
  try {
    await api("/api/schedules/" + encodeURIComponent(rule.id), method, body);
    if (method === "DELETE" && editingScheduleId === rule.id) closeScheduleEditor();
    notice(method === "DELETE" ? "Schedule deleted. Existing recordings are kept." : "Schedule updated.");
  } catch (e) {
    notice(e.message, true);
  } finally {
    scheduleBusy = false;
    await refresh();
  }
}
function renderSchedules() {
  const key = JSON.stringify([schedules, scheduleBusy]);
  if (key === renderedSchedulesKey) return;
  renderedSchedulesKey = key;
  $("schedules").replaceChildren();
  if (!schedules.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No recurring meetings yet. Add a meeting and choose the weekdays when the bot should join.";
    $("schedules").append(empty);
  }
  for (const rule of schedules) {
    const card = document.createElement("article");
    card.className = "schedule-card";
    const title = document.createElement("strong");
    title.textContent = rule.name;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = rule.enabled ? "Enabled" : "Paused";
    const summary = document.createElement("p");
    summary.textContent = rule.weekdays.map(day => dayNames[day]).join(", ") + " · " + rule.time + " · " + rule.timeZone + " · " + modeNames[rule.recordingMode];
    const next = document.createElement("p");
    next.className = "muted";
    next.textContent = rule.enabled && rule.nextRunAt ? "Next: " + scheduleDate(rule.nextRunAt, rule.timeZone) + " · " + rule.timeZone : "Paused — no automatic launches.";
    const bot = document.createElement("p");
    bot.className = "muted";
    bot.textContent = "Bot: " + (rule.botName ?? "Engineering Assistant");
    card.append(title, badge, summary, bot, next);
    if (rule.lastRun) {
      const result = document.createElement("p");
      const statuses = { starting: "Starting", started: "Started", skipped: "Skipped", failed: "Failed to start" };
      result.className = ["skipped", "failed"].includes(rule.lastRun.status) ? "error" : "muted";
      result.textContent = statuses[rule.lastRun.status] + " · " + scheduleDate(rule.lastRun.scheduledAt, rule.timeZone) + (rule.lastRun.reason ? " — " + rule.lastRun.reason : "");
      card.append(result);
    }
    const actions = document.createElement("div");
    actions.className = "actions";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "secondary";
    edit.textContent = "Edit";
    edit.disabled = scheduleBusy;
    edit.addEventListener("click", () => editSchedule(rule));
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "secondary";
    toggle.textContent = rule.enabled ? "Pause" : "Resume";
    toggle.disabled = scheduleBusy;
    toggle.addEventListener("click", () => void changeSchedule(rule, "PUT", { enabled: !rule.enabled }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-session";
    remove.textContent = "Delete schedule";
    remove.disabled = scheduleBusy;
    remove.addEventListener("click", () => {
      if (window.confirm("Delete this recurring schedule? Existing recordings will be kept.")) void changeSchedule(rule, "DELETE", {});
    });
    actions.append(edit, toggle, remove);
    card.append(actions);
    $("schedules").append(card);
  }
}
$("add-schedule").addEventListener("click", () => editSchedule());
$("cancel-schedule").addEventListener("click", closeScheduleEditor);
$("schedule-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (scheduleBusy) return;
  const weekdays = [...document.querySelectorAll('input[name="weekday"]:checked')].map(input => Number(input.value));
  if (!weekdays.length) { notice("Choose at least one weekday.", true); return; }
  const body = {
    name: $("schedule-name").value, meetingUrl: $("schedule-url").value,
    botName: $("schedule-bot").value,
    weekdays, time: $("schedule-time").value, timeZone: $("schedule-zone").value,
    recordingMode: $("schedule-mode").value,
  };
  const id = editingScheduleId;
  scheduleBusy = true;
  const controls = [...$("schedule-form").elements];
  for (const control of controls) control.disabled = true;
  $("add-schedule").disabled = true;
  renderSchedules();
  try {
    await api("/api/schedules" + (id ? "/" + encodeURIComponent(id) : ""), id ? "PUT" : "POST", body);
    closeScheduleEditor();
    notice("Recurring meeting saved.");
  } catch (e) {
    notice(e.message, true);
  } finally {
    scheduleBusy = false;
    for (const control of controls) control.disabled = false;
    $("add-schedule").disabled = false;
    await refresh();
  }
});
$("join").addEventListener("submit", async (event) => {
  event.preventDefault();
  busy = true;
  $("start").disabled = true;
  try {
    await settingsQueue;
    await api("/api/settings", "PUT", { botName: $("botName").value, recordingMode: $("recordingMode").value });
    await api("/api/sessions", "POST", {
      meetingName: $("meetingName").value,
      meetingUrl: $("meetingUrl").value,
      botName: $("botName").value,
      recordingMode: $("recordingMode").value,
    });
    $("meetingUrl").value = "";
    $("record-dialog").close();
    notice(
      "The bot is starting. Admit it from the waiting room if needed.",
    );
  } catch (e) {
    notice(e.message, true);
  } finally {
    busy = false;
    await refresh();
  }
});
async function saveSettings(event) {
  const fromSettings = event?.type === "submit";
  event?.preventDefault();
  const button = $("settings-form").querySelector("button");
  if (fromSettings) button.disabled = true;
  const values = {
    botName: $(fromSettings ? "settings-bot" : "botName").value,
    recordingMode: $(fromSettings ? "settings-mode" : "recordingMode").value,
  };
  const source = fromSettings ? "settings" : "drawer";
  const target = fromSettings ? "drawer" : "settings";
  const save = settingsQueue.then(() => api("/api/settings", "PUT", values));
  settingsQueue = save.catch(() => {});
  try {
    await save;
    if (!settingsDirty[target]) {
      $(fromSettings ? "botName" : "settings-bot").value = values.botName;
      $(fromSettings ? "recordingMode" : "settings-mode").value = values.recordingMode;
    }
    if ($(fromSettings ? "settings-bot" : "botName").value === values.botName &&
        $(fromSettings ? "settings-mode" : "recordingMode").value === values.recordingMode) settingsDirty[source] = false;
    notice("Settings saved for future meetings.");
  } catch (e) {
    notice(e.message, true);
  } finally {
    button.disabled = false;
  }
}
for (const id of ["settings-bot", "settings-mode", "botName", "recordingMode"]) {
  $(id).addEventListener("input", () => { settingsDirty[id.startsWith("settings-") ? "settings" : "drawer"] = true; });
}
$("settings-form").addEventListener("submit", saveSettings);
$("botName").addEventListener("change", saveSettings);
$("recordingMode").addEventListener("change", saveSettings);
$("stop").addEventListener("click", async () => {
  if (!activeId) return;
  busy = true;
  $("stop").disabled = true;
  try {
    await api("/api/sessions/" + activeId + "/stop", "POST", {});
    notice("Saving files and disconnecting the bot…");
  } catch (e) {
    notice(e.message, true);
  } finally {
    busy = false;
    await refresh();
  }
});
api("/api/settings")
  .then((s) => {
    $("botName").value = $("settings-bot").value = s.botName;
    $("recordingMode").value = $("settings-mode").value = s.recordingMode || "video";
  })
  .catch((e) => notice(e.message, true));
refresh();
setInterval(refresh, 2000);

$("meeting-search").addEventListener("input", () => render(latestSessions));
$("record-meeting").addEventListener("click", () => {
  $("record-notice").textContent = "";
  $("record-notice").hidden = true;
  $("record-dialog").showModal();
  $("meetingName").focus();
});
$("close-record").addEventListener("click", () => $("record-dialog").close());
$("record-dialog").addEventListener("close", () => $("record-meeting").focus());
setInterval(updateTimer, 1000);
