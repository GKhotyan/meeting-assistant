import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { log, callNeedsHumanHelpCallback } from '../_host';

let escalationTriggered = false;
let vncStarted = false;

export interface EscalationResult {
  reason: string;
  urgency: 'high' | 'critical';
}

/**
 * Check if escalation should be triggered based on admission state.
 * Called from each platform's admission poll loop.
 * Returns non-null if escalation is needed.
 */
export function checkEscalation(
  elapsedMs: number,
  timeoutMs: number,
  unknownStateDurationMs: number,
  joinFailed?: boolean,
  pageAlive?: boolean
): EscalationResult | null {
  if (escalationTriggered) return null;

  if (elapsedMs > timeoutMs * 0.8) {
    return { reason: 'waiting_room_timeout_approaching', urgency: 'high' };
  }
  if (unknownStateDurationMs > 10_000) {
    return { reason: 'unknown_blocking_state', urgency: 'critical' };
  }
  if (joinFailed && pageAlive) {
    return { reason: 'join_error_page_alive', urgency: 'critical' };
  }
  return null;
}

/**
 * Trigger escalation: start VNC stack and notify meeting-api.
 * Idempotent — only fires once per admission attempt.
 */
export async function triggerEscalation(botConfig: any, reason: string): Promise<void> {
  if (escalationTriggered) return;
  escalationTriggered = true;

  log(`[Escalation] Triggered: ${reason}`);
  await startVncStack();
  await callNeedsHumanHelpCallback(botConfig, reason);
}

/**
 * Lazily start VNC stack on the existing Xvfb :99 display.
 * Meeting bots already render to :99 — this just exposes it.
 */
export async function startVncStack(): Promise<void> {
  log('[Admission] Manual help required; see session status. Remote desktop is disabled.');
}

export async function startDebugView(): Promise<{ vncUrl?: string; novncUrl?: string; cdpUrl: string }> {
  await startVncStack();
  const onLinux = process.platform === 'linux' && !!process.env.DISPLAY;
  return {
    vncUrl: onLinux ? 'vnc://localhost:5900' : undefined,
    novncUrl: onLinux ? 'http://localhost:6080/vnc.html' : undefined,
    cdpUrl: 'http://localhost:9222', // Playwright connectOverCDP target
  };
}

/**
 * Extra time (ms) granted when escalation is active, so the user has time to intervene.
 */
export function getEscalationExtensionMs(): number {
  return escalationTriggered ? 5 * 60 * 1000 : 0;
}

export function wasEscalationTriggered(): boolean {
  return escalationTriggered;
}

export function resetEscalation(): void {
  escalationTriggered = false;
}

// ---- internal helpers ----

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const net = require('net');
      const socket = new net.Socket();
      socket.setTimeout(200);
      socket.once('connect', () => {
        socket.destroy();
        resolve();
      });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 200);
        } else {
          log('[Escalation] VNC port wait timed out — continuing anyway');
          resolve();
        }
      });
      socket.once('timeout', () => {
        socket.destroy();
        if (Date.now() - start < timeoutMs) {
          setTimeout(check, 200);
        } else {
          resolve();
        }
      });
      socket.connect(port, '127.0.0.1');
    };
    check();
  });
}
