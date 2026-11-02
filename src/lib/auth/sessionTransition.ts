const SESSION_TRANSITION_KEY = 'vendor-dashboard.session-transition';

export type SessionTransition = {
  version: 1;
  id: string;
  kind: 'login' | 'logout';
};

let fallbackSequence = 0;

export function parseSessionTransition(value: string | null): SessionTransition | null {
  if (!value) return null;

  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return null;
    const candidate = parsed as Partial<SessionTransition>;
    if (candidate.version !== 1 || (candidate.kind !== 'login' && candidate.kind !== 'logout')) return null;
    if (typeof candidate.id !== 'string' || !candidate.id.trim()) return null;
    return { version: 1, id: candidate.id, kind: candidate.kind };
  } catch {
    return null;
  }
}

export function readSessionTransition(): SessionTransition | null {
  try {
    return parseSessionTransition(window.localStorage.getItem(SESSION_TRANSITION_KEY));
  } catch {
    return null;
  }
}

export function publishSessionTransition(kind: SessionTransition['kind']): SessionTransition | null {
  try {
    fallbackSequence += 1;
    const id = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${fallbackSequence}-${Math.random().toString(36).slice(2)}`;
    const transition: SessionTransition = { version: 1, id, kind };
    window.localStorage.setItem(SESSION_TRANSITION_KEY, JSON.stringify(transition));
    return transition;
  } catch {
    // Notification is best effort; authentication success must not depend on storage.
    return null;
  }
}

export function onSessionTransition(handler: (transition: SessionTransition) => void) {
  if (typeof window === 'undefined') return () => {};

  const onStorage = (event: StorageEvent) => {
    if (event.key !== SESSION_TRANSITION_KEY || (event.storageArea && event.storageArea !== window.localStorage)) return;
    const transition = parseSessionTransition(event.newValue);
    if (transition) handler(transition);
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}
