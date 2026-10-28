# Разбор Vexa и границы эксперимента

Дата: 2026-10-26. Исходный checkout: `/Users/georgy/Documents/vexa`, f1a62fbbd. Только чтение; продуктовый код не изменялся.

## Expected

Найти переносимую Zoom-логику и запись аудио, установить наличие готового screen-share-only захвата. Не принимать наличие класса за доказательство его работы в текущем worker.

## Actual

- `core/meetings/modules/join/package.json`: самостоятельный модуль, зависимости playwright, playwright-extra, puppeteer-extra-plugin-stealth. Redis и БД в списке отсутствуют.
- `core/meetings/modules/join/src/zoom/{join,admission,removal,leave,selectors}.ts`: вход, имя, ожидание допуска, удаление и выход; импорты `_host` и shared admission/escalation требуют переноса небольшого host-контракта. Одного файла join недостаточно.
- `core/meetings/modules/join/src/zoom/selectors.ts`: различает классический/React Zoom UI; распознаёт запрет гостевого бота/RTMS. Готовых селекторов демонстрации здесь нет.
- `core/meetings/modules/record-chunker/src/index.ts`: браузерный MediaRecorder, onChunk, onStarted, stop; смешивает аудио media-элементов. Повторное использование потребует проверки смены audio sources, финального хвоста и ошибки при отсутствии источника.
- Последняя реальная сессия 3 в текущем Lite: лог `MediaRecorder started (audio/webm;codecs=opus)`, успешные выгрузки чанков; это наблюдение важнее старого комментария про PulseAudio-only Zoom в исходниках.
- `core/meetings/services/bot/src/index.ts`: wiring включает Redis, транскрипцию, HTTP lifecycle и HTTP recording upload; переносить entrypoint целиком нецелесообразно. Orchestrator/сигналы полезны, но контракты нужно выделить отдельно.
- `core/meetings/services/bot/build-browser-utils.mjs`: текущий bundle тянет Google Meet, Teams, Jitsi и Zoom. Новый проект собирает только выбранные Zoom/audio части.
- `core/meetings/modules/recording/src/video-recording.ts`: FFmpeg x11grab всего Xvfb display, WebM или MP4. Это не захват одного screen-share source. Поиск VideoRecordingService в worker src не показал подключение этого класса.
- `core/meetings/services/bot/entrypoint.sh`: запуск Xvfb/PulseAudio и forwarding TERM/INT. При переносе сохранить graceful stop и ожидание worker вместо обрыва записи.
- `core/meetings/services/bot/Dockerfile`: использует `vexa/meet-join-env:dev`, копирует core и модели транскрипции. Для независимой сборки требуется собственный Dockerfile без Vexa image и моделей.
- Папка `/Users/georgy/Documents/engineering-assistant` перед работой пуста.
- `docker ps`: текущие vexa-lite, postgres, storage healthy/running; для этой работы не перезапускались.

Команды: чтение package.json/Dockerfile/entrypoint, `rg` по Zoom selectors, screen-share и VideoRecordingService, `docker ps`. Ключи и содержимое разговоров не переносились.

## Verdict

Zoom-подключение и audio recorder можно выделить; прямой перенос всего worker не нужен. Готовый режим записи только демонстрации не найден. Он является основной исследовательской неопределённостью.

## NOT checked

Не выполнялись новая сборка, новая установка зависимостей или вход в Zoom. Не исследован живой DOM шаринга; селекторы/track extraction не доказаны. Нет работающего прототипа screen-share-only. Не проверены VPS и multi-arch image. Не проверена каждая транзитивная зависимость. Для живого эксперимента запрошена тестовая Zoom-встреча у пользователя; старый адрес встречи автоматически не использовался.
