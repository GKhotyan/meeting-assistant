# Engineering Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Независимый Docker-бот с браузерным интерфейсом, записью Zoom-аудио и отдельной видеозаписью всего виртуального экрана бота на постоянный диск.

**Architecture:** Один HTTP server управляет одним worker-процессом с Chromium/Xvfb. Модули Zoom из Vexa переносятся вместе с минимальными host/shared зависимостями; запись идёт непосредственно на подключённый каталог. Экран включает Zoom и видимые в нём камеры/демонстрацию; видео не имеет аудиодорожки.

**Tech Stack:** Node.js 22, TypeScript, Playwright (версию совместить с переносимым join-модулем; исходно 1.56.0), FFmpeg/ffprobe, Chromium, Xvfb, Docker Compose; статический HTML/CSS/JS, встроенные node:test и HTTP server, без React/БД/Redis/S3.

**Spec:** `docs/superpowers/specs/2026-10-26-engineering-assistant-design.md`.

## Global Constraints

- Новый проект: `/Users/georgy/Documents/engineering-assistant`; исходный Vexa только читаем.
- Только Zoom, одна активная встреча, имя по умолчанию Engineering Assistant.
- Аудио отдельным файлом на встречу; видео всего виртуального экрана бота и без аудиодорожки.
- Аудио и видео записываются всю встречу, независимо от наличия демонстрации. Рабочий стол Mac пользователя напрямую не захватывается.
- `./data:/data` для записей и метаданных; данные переживают пересоздание контейнера.
- Никаких запросов к API/облаку Vexa, Deepgram или календарю.
- Документировать происхождение переносимого кода, сохранять LICENSE/notices. Не коммитить без выбора человеком contribution/identity условий, если они применимы к новому репозиторию.
- Работа на Mac и Linux VPS проверяется отдельно; не обещать незамеченное платформенное поведение.

## Review Focus

1. Окно Zoom/размер экрана: запись содержит полноразмерный Zoom, смена демонстрации не прерывает видеопоток (task 1/4).
2. SIGTERM между записью последнего блока и финализацией: хвост не теряется при graceful shutdown, при SIGKILL части остаются и помечаются partial (task 3).
3. Двойной клик/два запроса запуска: одна сессия, второй запрос 409; рестарт не возрождает старый worker (task 2).
4. Zoom URL с паролем и файловый traversal: пароль не попадает в логи, скачивание только файлов данной сессии (task 5).
5. Нет места/прав записи: видимая ошибка, прекращение записи, существующие файлы не удаляются (task 3/5).

---

## Файловая структура

- `vendor/vexa/join/`: Zoom + действительно необходимые shared/host файлы и соответствующие тесты, с provenance.
- `vendor/vexa/record-chunker/`: браузерная аудиозапись без остальных платформ.
- `src/session/{types,controller,store}.ts`: состояние, один worker, атомарные метаданные.
- `src/worker/{main,zoom,audio,screen,signals}.ts`: браузер, capture, остановка.
- `src/recordings/{writer,finalize}.ts`: запись частей и FFmpeg финализация.
- `src/server/{main,routes,auth}.ts`, `public/{index.html,app.js,style.css}`: API и UI.
- `tools/full-screen-probe.sh`, `tests/fixtures/`: изолированное исследование; не объявлять частью продукта до live pass.
- `tests/{controller,recordings,screen,api}.test.ts`, `Dockerfile`, `compose.yaml`, `.env.example`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`.

### Task 1: Живой эксперимент полного экрана

**Files:** `tools/full-screen-probe.sh`, `docs/research/full-screen-probe.md`.
**Consumes:** тестовая Zoom-встреча; существующий Linux Docker/Xvfb только как среда эксперимента.
**Produces:** MP4 H.264 без звуковой дорожки и evidence ожидаемого изображения. Продукт позже собирается независимо от образов Vexa.

- [x] Войти в тестовую встречу под именем Engineering Assistant, проверить видимость демонстрации.
- [x] Записать 10 секунд FFmpeg x11grab; ffprobe: h264, 1920×1080, 10 секунд, только video stream.
- [x] Просмотреть первый кадр: демонстрация присутствует; окно Zoom занимает только часть кадра, мешает onboarding popup.
- [ ] Проверить полноэкранный режим и закрытие popup, просмотреть повторную запись.
- [ ] Сохранить Expected/Actual/Verdict, отметить отсутствие проверки полного аудио+видео жизненного цикла.

### Task 2: Независимый worker и управление сессиями

**Files:** `package.json`, `tsconfig.json`, `vendor/vexa/join/**`, `src/session/**`, `src/worker/{main,zoom,signals}.ts`, `tests/controller.test.ts`, provenance/notices.
**Interfaces:** `startSession(input:{meetingUrl:string;botName:string}):Promise<Session>`; `stopSession(id:string):Promise<void>`; `getSession(id:string):Promise<Session|undefined>`. `Session={id,botName,createdAt,status,files,error?}`; `status` из spec; `files:RecordingFile[]`, тип в task 3. Worker IPC: status/error/file сообщения с sessionId.

- [ ] Написать node:test проверки: два конкурентных start создают один worker; второй отклонён 409; stop идемпотентен; рестарт помечает running-сессию interrupted.
- [ ] Запустить `npm test -- --test-name-pattern=controller` через установленный test runner; ожидаемый red — отсутствует реализация. Зафиксировать правильную команду в package.json прежде остальных tasks.
- [ ] Перенести Zoom и необходимые shared/host файлы с исходными тестами; минимально адаптировать host callbacks под IPC. Сохранить допуск/удаление/выход и имеющееся обнаружение запрета ботов.
- [ ] Реализовать controller с одним worker, настройками и атомарной записью JSON; отслеживание exit worker отдельно от статуса completed.
- [ ] Запустить `npm test` и `npm run typecheck`; скопированные Zoom tests должны проходить. Статический поиск сборки не должен находить imports за пределами нового проекта.

### Task 3: Запись аудио на диск и остановка

**Files:** `vendor/vexa/record-chunker/**`, `src/worker/audio.ts`, `src/recordings/{writer,finalize}.ts`, `tests/recordings.test.ts`.
**Interfaces:** `RecordingFile={id:string;name:string;kind:'audio'|'screen';status:'partial'|'ready';startedAtMs:number;endedAtMs?:number;bytes:number}`; `createAudioRecorder(page,sessionDir):Promise<{stop():Promise<RecordingFile>}>`; `appendChunk(sessionDir:string,sequence:number,data:Uint8Array):Promise<void>`; `finalizeAudio(sessionDir:string):Promise<RecordingFile>`.

- [ ] Red tests с реальной маленькой MediaRecorder/WebM fixture: последовательность частей, последняя короткая часть, нулевой финальный marker, отказ записи, аварийная остановка до финализации.
- [ ] Сохранить onChunk на диск вместо HTTP/S3, ожидать onstop и последнюю очередь IO; финализировать WebM без перекодирования, публиковать имя атомарно после успеха.
- [ ] Подключить SIGTERM/INT к общей stop-последовательности: capture stop → drain → finalize → browser close; bounded watchdog, stop_grace_period 60s, partial при превышении.
- [ ] `npm test`, `ffprobe` и `ffmpeg -v error -i <fixture-output> -f null -`; финальный хвост fixture слышим/имеет ожидаемые длительность и samples. После SIGKILL сохранённые parts остаются.

### Task 4: Полный виртуальный экран отдельно от аудио

**Files:** `src/worker/screen.ts`, `tests/screen.test.ts`.
**Interfaces:** `createScreenRecorder(display:string,sessionDir:string):Promise<{stop():Promise<RecordingFile>}>`; `kind:'screen'`. Результат `screen.mp4`, H.264, без audio stream; session manifest хранит начало/конец по общей шкале времени аудио и видео.

- [ ] Red tests: параметры FFmpeg включают x11grab и -an; stop ожидает exit; раннее падение процесса вызывает failed; частичная запись сохраняется; нет демонстрации — запись продолжается.
- [ ] Реализовать fullscreen Zoom в собственном Xvfb, FFmpeg H.264/yuv420p, 15 fps, 1920×1080, graceful stop и атомарную публикацию после закрытия MP4. Не применять crop по предположительным screen-share координатам.
- [ ] Тесты и реальный Zoom: демонстрация → остановка демонстрации → повторное включение; полный видеопоток непрерывен, ffprobe audio stream count=0; отдельная аудиозапись тоже непрерывна.
- [ ] Проверить ручной просмотр, длительность и синхронизацию по записанному в manifest смещению; в пустом рабочем столе не теряется существенная часть разрешения.

### Task 5: Браузерная страница и HTTP API

**Files:** `src/server/**`, `public/**`, `tests/api.test.ts`, `.env.example`.
**Interfaces:** API paths из spec; `GET /api/sessions` возвращает `{sessions:Session[]}`; settings `{botName:string}`; download resolver работает по sessionId/fileId, не filesystem path. UI опрашивает статусы, сервер продолжает работу без вкладки.

- [ ] Red API tests: валидная Zoom HTTPS ссылка, пустое имя/не-Zoom URL, двойной запуск=409, stop, сохранение имени, ошибка worker, 404 на неизвестный файл/traversal, аутентификация при server mode.
- [ ] Реализовать routes с ограничением размера тела и без shell interpolation; basename файлов генерируется приложением, secrets удаляются из логов. Только ready файлы доступны как готовые; partial явно подписаны.
- [ ] Минимальная страница: имя/ссылка, start/stop, состояние, ошибка и отдельные ссылки аудио/демонстраций; ссылки из пользователя не вставляются через innerHTML.
- [ ] `npm test`, typecheck, browser walkthrough: закрыть вкладку во время записи и открыть вновь, имя и активная сессия сохраняются; скачать файлы и сравнить SHA256 с диском.

### Task 6: Docker, проверка на Mac и перенос на VPS

**Files:** `Dockerfile`, `compose.yaml`, `.dockerignore`, `README.md`, `docs/validation.md`.
**Interfaces:** `docker compose up --build -d`, порт по умолчанию `127.0.0.1:8088`, volume `./data:/data`, health endpoint `/health`, graceful stop 60s. Предложенная конфигурация; проверить порт перед запуском.

- [ ] Собрать image только из engineering-assistant, без vexa images, моделей/транскрипции и соседнего контекста. Pin base image/browser dependency и документировать платформы.
- [ ] Запускать сервер и worker без Docker socket; проверить запись bind mount текущим UID, достаточный shm, доступность Xvfb/FFmpeg.
- [ ] Mac live acceptance: имя Engineering Assistant, waiting room, фраза, два шаринга, no-share контроль, stop button, host ends, SIGTERM. Записать команды/артефакты/непроверенное.
- [ ] `docker compose down` → up: настройки/файлы на месте, завершённые сессии не запускаются заново.
- [ ] Только при наличии VPS: самостоятельная сборка/запуск, защита интерфейса и HTTPS, живой Zoom. Без VPS отметить этот этап непроверенным.
- [ ] README: запуск, путь к данным на Mac/VPS, ограничения Zoom, резервное копирование, остановка, просмотр логов, отсутствие внешней транскрипции, восстановление partial и управление местом на диске.

## Статус на 2026-10-26

План и разбор подготовлены. Пользователь упростил требование: захватываем весь виртуальный экран бота; аудио отдельно. Короткий live video spike выполнен в текущем Vexa Lite, но это не самостоятельная сборка и не проверка готового продукта. Полный жизненный цикл и VPS ещё не проверены. Продуктовый код не переносился.
