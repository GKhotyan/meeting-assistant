const $ = (id) => document.getElementById(id);
let activeId = null;
let busy = false;
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
  $("notice").textContent = text;
  $("notice").className = error ? "error" : "";
}
function render(sessions) {
  $("sessions").replaceChildren();
  activeId =
    sessions.find(
      (s) => !["completed", "failed", "interrupted"].includes(s.status),
    )?.id || null;
  $("start").disabled = busy || !!activeId;
  $("stop").disabled = busy || !activeId;
  if (!sessions.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No recordings yet. Paste a meeting link to get started.";
    $("sessions").append(p);
  }
  for (const s of sessions) {
    const card = document.createElement("article"),
      title = document.createElement("strong"),
      meta = document.createElement("p"),
      state = document.createElement("span");
    title.textContent = s.botName;
    state.textContent = labels[s.status] || s.status;
    state.className = "badge " + s.status;
    meta.className = "muted";
    meta.textContent =
      new Date(s.createdAt).toLocaleString("en-US") + " · " + s.id.slice(0, 8);
    card.append(title, state, meta);
    if (s.error) {
      const error = document.createElement("p");
      error.textContent = s.error;
      error.className = "error";
      card.append(error);
    }
    for (const file of s.files) {
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
      card.append(link);
    }
    if (["interrupted", "failed"].includes(s.status)) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent =
        "Available recording chunks and logs are saved in this session’s folder.";
      card.append(p);
    }
    $("sessions").append(card);
  }
}
async function refresh() {
  try {
    const data = await api("/api/sessions");
    render(data.sessions);
    $("connection").textContent = "Connected";
  } catch (e) {
    $("connection").textContent = "Disconnected";
  }
}
$("join").addEventListener("submit", async (event) => {
  event.preventDefault();
  busy = true;
  $("start").disabled = true;
  try {
    await api("/api/settings", "PUT", { botName: $("botName").value, recordingMode: $("recordingMode").value });
    await api("/api/sessions", "POST", {
      meetingUrl: $("meetingUrl").value,
      botName: $("botName").value,
      recordingMode: $("recordingMode").value,
    });
    $("meetingUrl").value = "";
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
async function saveSettings() {
  try {
    await api("/api/settings", "PUT", { botName: $("botName").value, recordingMode: $("recordingMode").value });
    notice("Settings saved for future meetings.");
  } catch (e) {
    notice(e.message, true);
  }
}
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
    $("botName").value = s.botName;
    $("recordingMode").value = s.recordingMode || "video";
  })
  .catch((e) => notice(e.message, true));
refresh();
setInterval(refresh, 2000);
