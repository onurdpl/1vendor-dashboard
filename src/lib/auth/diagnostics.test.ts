import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearAuthDiagnosticEvents,
  createAuthDiagnosticId,
  getAuthDiagnosticEvents,
  printAuthDiagnosticTimeline,
  recordAuthDiagnostic,
} from './diagnostics';

afterEach(() => {
  clearAuthDiagnosticEvents();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  delete window.__vendorAuthDiagnostics;
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('temporary auth flow diagnostics', () => {
  it('does not log or buffer events when VITE_AUTH_DIAGNOSTICS is disabled', () => {
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    recordAuthDiagnostic('LOGIN_SUBMIT', {
      flowId: 'auth-test123',
      requestId: 'req-test123',
      source: 'diagnostics.test',
      resultCategory: 'started',
    });

    expect(getAuthDiagnosticEvents()).toEqual([]);
    expect(debugSpy).not.toHaveBeenCalled();
    expect(window.__vendorAuthDiagnostics).toBeUndefined();
  });

  it('keeps a bounded in-memory timeline and exposes a gated debug exporter only when enabled', () => {
    vi.stubEnv('VITE_AUTH_DIAGNOSTICS', 'true');
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);

    for (let index = 0; index < 205; index += 1) {
      recordAuthDiagnostic('SESSION_RESTORE_START', {
        flowId: 'restore-test123',
        requestId: createAuthDiagnosticId('req'),
        source: 'diagnostics.test',
        resultCategory: 'started',
        cachedUserPresent: index % 2 === 0,
      });
    }

    const events = getAuthDiagnosticEvents();
    expect(events).toHaveLength(200);
    expect(events[0]).toMatchObject({
      operation: 'SESSION_RESTORE_START',
      flowId: 'restore-test123',
      source: 'diagnostics.test',
    });
    expect(printAuthDiagnosticTimeline()).toContain('SESSION_RESTORE_START');
    expect(window.__vendorAuthDiagnostics?.events()).toHaveLength(200);
    expect(window.localStorage.getItem('vendor-dashboard.auth-diagnostics')).toBeNull();
    expect(window.sessionStorage.getItem('vendor-dashboard.auth-diagnostics')).toBeNull();
    expect(JSON.stringify(events)).not.toContain('password');
    expect(debugSpy).toHaveBeenCalled();
  });
});
