import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  onSessionTransition,
  parseSessionTransition,
  publishSessionTransition,
  readSessionTransition,
} from './sessionTransition';
import { setCurrentVendorId, setSession } from '../auth';

const key = 'vendor-dashboard.session-transition';

describe('cross-tab session transition signal', () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('publishes distinct, versioned, non-secret transitions without dispatching in its own tab', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTransition(listener);
    const first = publishSessionTransition('login');
    const second = publishSessionTransition('logout');

    expect(first).toMatchObject({ version: 1, kind: 'login', id: expect.any(String) });
    expect(second).toMatchObject({ version: 1, kind: 'logout', id: expect.any(String) });
    expect(second?.id).not.toBe(first?.id);
    expect(readSessionTransition()).toEqual(second);
    expect(Object.keys(second ?? {}).sort()).toEqual(['id', 'kind', 'version']);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('accepts a valid cross-tab storage event and rejects malformed or unsupported values', () => {
    const listener = vi.fn();
    const unsubscribe = onSessionTransition(listener);
    const valid = JSON.stringify({ version: 1, kind: 'login', id: 'transition-1' });
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: valid }));
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: '{' }));
    window.dispatchEvent(new StorageEvent('storage', { key, newValue: JSON.stringify({ version: 2, kind: 'login', id: 'old' }) }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'vendor-dashboard.current-vendor-id', newValue: valid }));

    expect(listener).toHaveBeenCalledExactlyOnceWith({ version: 1, kind: 'login', id: 'transition-1' });
    expect(parseSessionTransition(null)).toBeNull();
    expect(parseSessionTransition('{}')).toBeNull();
    expect(parseSessionTransition(JSON.stringify({ version: 1, kind: 'login', id: '' }))).toBeNull();
    unsubscribe();
  });

  it('does not throw when nonessential storage notification fails', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => { throw new Error('storage blocked'); });
    expect(publishSessionTransition('login')).toBeNull();
  });

  it('does not treat session hydration or Vendor selection as a transition', () => {
    setSession(null, {
      email: 'vendor@example.com',
      name: 'Vendor User',
      role: 'vendor',
      vendorAccess: ['vendor-a'],
      canSwitchVendors: false,
      defaultVendorId: 'vendor-a',
    });
    setCurrentVendorId('vendor-a');
    expect(readSessionTransition()).toBeNull();
  });
});
