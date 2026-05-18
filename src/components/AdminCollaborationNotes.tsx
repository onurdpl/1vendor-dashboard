import { FormEvent, useEffect, useMemo, useState } from 'react';
import type { CurrentUser } from '../lib/auth';
import { MentionText } from './MentionText';

type AdminCollaborationNote = {
  id: string;
  contextType: 'order' | 'return' | 'finance';
  contextId: string;
  authorName: string;
  content: string;
  createdAt: string;
};

const STORAGE_KEY = 'vendor-dashboard.admin-collaboration-notes';

function readNotes(): AdminCollaborationNote[] {
  if (typeof window === 'undefined') {
    return [];
  }
  const serialized = window.localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return [];
  }
  try {
    const parsed = JSON.parse(serialized) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isNote) : [];
  } catch {
    return [];
  }
}

function isNote(value: unknown): value is AdminCollaborationNote {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const note = value as Partial<AdminCollaborationNote>;
  return (
    typeof note.id === 'string' &&
    (note.contextType === 'order' || note.contextType === 'return' || note.contextType === 'finance') &&
    typeof note.contextId === 'string' &&
    typeof note.authorName === 'string' &&
    typeof note.content === 'string' &&
    typeof note.createdAt === 'string'
  );
}

function writeNotes(notes: AdminCollaborationNote[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function AdminCollaborationNotes({
  contextType,
  contextId,
  currentUser,
}: {
  contextType: AdminCollaborationNote['contextType'];
  contextId: string;
  currentUser: CurrentUser | null;
}) {
  const isAdmin = currentUser?.role === 'admin';
  const [notes, setNotes] = useState<AdminCollaborationNote[]>([]);
  const [content, setContent] = useState('');

  useEffect(() => {
    if (!isAdmin) {
      return;
    }
    setNotes(readNotes());
  }, [isAdmin]);

  const visibleNotes = useMemo(
    () =>
      notes
        .filter((note) => note.contextType === contextType && note.contextId === contextId)
        .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()),
    [contextId, contextType, notes],
  );

  if (!isAdmin) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim()) {
      return;
    }
    const nextNote: AdminCollaborationNote = {
      id: `admin-note-${Date.now()}`,
      contextType,
      contextId,
      authorName: currentUser?.name ?? 'Admin',
      content: content.trim(),
      createdAt: new Date().toISOString(),
    };
    const nextNotes = [nextNote, ...notes];
    writeNotes(nextNotes);
    setNotes(nextNotes);
    setContent('');
  }

  return (
    <article className="admin-collab-card">
      <div className="admin-collab-heading">
        <div>
          <p className="eyebrow">Admin collaboration</p>
          <h3>Internal notes</h3>
        </div>
        <span>{visibleNotes.length}</span>
      </div>
      <div className="admin-collab-list">
        {visibleNotes.length ? (
          visibleNotes.map((note) => (
            <div key={note.id} className="admin-collab-note">
              <div>
                <strong>{note.authorName}</strong>
                <span>{formatDate(note.createdAt)}</span>
              </div>
              <p>
                <MentionText text={note.content} />
              </p>
            </div>
          ))
        ) : (
          <p className="admin-collab-empty">No internal notes yet.</p>
        )}
      </div>
      <form className="admin-collab-form" onSubmit={handleSubmit}>
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          placeholder="Add an internal note. Use @name for lightweight mentions."
          rows={3}
        />
        <button type="submit" className="button button-secondary" disabled={!content.trim()}>
          Add note
        </button>
      </form>
    </article>
  );
}
