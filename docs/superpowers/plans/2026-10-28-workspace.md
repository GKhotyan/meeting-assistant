# Meeting Assistant Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the approved English light workspace.
**Architecture:** Preserve API calls and recording controls. Restructure existing HTML, replace CSS and extend the browser state for navigation, search, a native dialog drawer and active-session time.
**Tech Stack:** Existing vanilla HTML/CSS/JS, Playwright, Node tests.
**Spec:** docs/superpowers/specs/2026-10-28-workspace-design.md

## Global Constraints
- All interface copy is English.
- Preserve uncommitted work; no commits, backend changes or deployment.
- No new dependencies.

## Review Focus
- Polling must preserve search, form edits and expanded screenshots.
- A filtered-out active meeting must remain stoppable.
- Drawer closes via Escape, returns focus, and fits mobile.
- Empty results and zero recordings must be distinct.
- Settings must persist and populate the recording form.

### Task 1: Workspace
**Files:** public/index.html, public/style.css, public/app.js; tests/browser-workspace.cjs.
**Interfaces:** Existing /api/settings, /api/sessions and /api/schedules contracts unchanged.
- [x] Add browser coverage for navigation, search, drawer keyboard behavior, settings persistence, active state and mobile overflow; run against old UI and confirm missing navigation fails.
- [x] Implement sidebar, page views, accessible recording drawer, English settings, search and duration/active state. Preserve download links and screenshot scroll behavior.
- [x] Run browser coverage at desktop/mobile, inspect screenshots, run existing scroll and files checks where compatible.
- [x] Run npm test, npm run build and review changed frontend for regressions.

Verification: workspace RED (missing navigation) → GREEN; delayed settings response and schedule focus regressions RED → GREEN. Existing files and scroll browser checks passed. 53/53 Node tests; build passed. Desktop/mobile screenshots inspected. Local container rebuilt and read-only browser smoke passed at localhost:8088. No live Zoom meeting started.

Final review: independent reviewer found stale settings response overwrites and schedule keyboard focus loss; both corrected and covered by browser regressions. Ruling: update the local app container after checking no active sessions; no remote deployment or commits.
