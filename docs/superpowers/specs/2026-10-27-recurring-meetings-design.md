# Recurring meetings

Approved in conversation: separate Join now and Schedule tabs, shared recording history, weekly rules with a name, Zoom URL, selected weekdays, local time, time zone (Europe/Moscow default), recording mode, editing, pause/resume and deletion. One active worker; overlapping launches are skipped with a visible reason.

Approaches: a weekly rules list matches recurring dailies better than a monthly date grid; use the existing Node server and JSON persistence rather than an external scheduling service. The user accepted the list and single-worker behavior.

Implementation decisions: poll every ten seconds; claim each occurrence on disk before starting to avoid duplicate launches after restart. Start within the scheduled minute only. Mark older occurrences missed rather than unexpectedly joining late. Paused rules do not catch up. Compute using explicit IANA zones, independent of Docker's zone. Skip nonexistent DST times and run ambiguous wall times once. Persist the latest launch outcome and the next launch time. URLs stay in local storage/API only and never go into scheduler logs.

No parallel workers, external calendar integration, dated one-off meetings, or automatic retry for this version. The service must be running for automation.
