import { useEffect, useState } from 'react';

type FeedbackTone = 'success' | 'error' | 'info';

export function useActionFeedback(timeoutMs = 2200) {
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<FeedbackTone>('success');

  useEffect(() => {
    if (!message) {
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      setMessage(null);
    }, timeoutMs);

    return () => {
      globalThis.clearTimeout(timeout);
    };
  }, [message, timeoutMs]);

  function showFeedback(nextMessage: string, nextTone: FeedbackTone = 'success') {
    setTone(nextTone);
    setMessage(nextMessage);
  }

  return {
    message,
    tone,
    showFeedback,
    clearFeedback: () => setMessage(null),
  } as const;
}
