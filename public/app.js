const $ = (id) => document.getElementById(id);
let activeId = null;
let busy = false;
const labels = {
  queued: "Запуск",
  joining: "Подключение",
  waiting: "Ожидание допуска",
  recording: "Идёт запись",
  stopping: "Сохранение и выход",
  completed: "Завершена",
  failed: "Ошибка",
  interrupted: "Прервана",
};
async function api(path, method = "GET", body) {
  const response = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "Ошибка запроса");
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
    p.textContent = "Пока нет записей. Вставьте ссылку и подключите бота.";
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
      new Date(s.createdAt).toLocaleString() + " · " + s.id.slice(0, 8);
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
        (file.kind === "audio" ? "↓ Аудио" : file.kind === "screenshot" ? "↓ Скриншот " + new Date(file.startedAtMs).toLocaleTimeString() : "↓ Видео экрана") +
        " · " +
        (file.bytes / 1024 / 1024).toFixed(1) +
        " МБ";
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
        "Доступные фрагменты и журнал сохранены в папке этой встречи.";
      card.append(p);
    }
    $("sessions").append(card);
  }
}
async function refresh() {
  try {
    const data = await api("/api/sessions");
    render(data.sessions);
    $("connection").textContent = "Сервис доступен";
  } catch (e) {
    $("connection").textContent = "Нет связи с сервисом";
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
      "Бот запускается. При необходимости допустите его из комнаты ожидания.",
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
    notice("Настройки сохранены для следующих подключений.");
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
    notice("Сохраняю файлы и отключаю бота…");
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
