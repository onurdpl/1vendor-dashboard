import { describe, expect, it } from 'vitest';
import { determineOperationalHealth } from '../backend/src/modules/observability/observability.service.js';

describe('observability health classification', () => {
  it('reports healthy when no retry, failure, or stale pressure exists', () => {
    expect(determineOperationalHealth({
      failureRate24h: 0,
      retryPressure: 0,
      deadLetterReady: 0,
      permanentlyFailed: 0,
      staleStateCount: 0,
    })).toBe('healthy');
  });

  it('escalates retry and stale-state pressure without fake precision', () => {
    expect(determineOperationalHealth({
      failureRate24h: 0.02,
      retryPressure: 1,
      deadLetterReady: 0,
      permanentlyFailed: 0,
      staleStateCount: 0,
    })).toBe('warning');
    expect(determineOperationalHealth({
      failureRate24h: 0.1,
      retryPressure: 11,
      deadLetterReady: 0,
      permanentlyFailed: 0,
      staleStateCount: 2,
    })).toBe('degraded');
  });

  it('marks dead-letter and permanent failure pressure as critical when appropriate', () => {
    expect(determineOperationalHealth({
      failureRate24h: 0.1,
      retryPressure: 0,
      deadLetterReady: 3,
      permanentlyFailed: 0,
      staleStateCount: 0,
    })).toBe('critical');
    expect(determineOperationalHealth({
      failureRate24h: 0,
      retryPressure: 0,
      deadLetterReady: 0,
      permanentlyFailed: 1,
      staleStateCount: 0,
    })).toBe('critical');
  });
});
