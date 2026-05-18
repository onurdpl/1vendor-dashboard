import type { ReactNode } from 'react';

export function MentionText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  const pattern = /(@[a-zA-Z0-9._-]+)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) {
      continue;
    }
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <span key={`${match[0]}-${match.index}`} className="mention-highlight">
        {match[0]}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return <>{parts}</>;
}
