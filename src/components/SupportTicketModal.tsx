import { useEffect, useState } from 'react';
import { createSupportTicket, type SupportTicketContextType, type SupportTicketPriority } from '../features/support/api';
import { useMutationAction } from '../hooks/useMutationAction';
import { getCurrentVendorContext } from '../lib/auth';
import { queryClient } from '../lib/api/queryClient';
import { queryKeys } from '../lib/api/queryKeys';

type SupportTicketModalProps = {
  open: boolean;
  contextType: SupportTicketContextType;
  contextId?: string | null;
  contextSnapshot?: Record<string, unknown> | null;
  defaultSubject?: string;
  onClose: () => void;
  onCreated?: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unable to create support ticket.';
}

export function SupportTicketModal({
  open,
  contextType,
  contextId,
  contextSnapshot,
  defaultSubject = '',
  onClose,
  onCreated,
}: SupportTicketModalProps) {
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<SupportTicketPriority>('normal');
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (open) {
      setSubject(defaultSubject);
      setMessage('');
      setPriority('normal');
      setSuccessMessage('');
    }
  }, [defaultSubject, open]);

  const mutation = useMutationAction(createSupportTicket, {
    onSuccess: () => {
      setSuccessMessage('Support ticket created.');
      const vendorId = getCurrentVendorContext().vendorId;
      void queryClient.invalidateQueries({ queryKey: queryKeys.support.tickets(vendorId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.support.tickets() });
      onCreated?.();
    },
  });

  if (!open) {
    return null;
  }

  const canSubmit = subject.trim().length > 0 && message.trim().length > 0 && !mutation.isPending;

  return (
    <div className="support-modal-backdrop" role="presentation">
      <section className="support-modal" role="dialog" aria-modal="true" aria-labelledby="support-ticket-title">
        <div className="support-modal-header">
          <div>
            <p className="eyebrow">Support</p>
            <h2 id="support-ticket-title">Contact support</h2>
            <p>Send this operational context to the internal support queue.</p>
          </div>
          <button type="button" className="support-modal-close" onClick={onClose} aria-label="Close support form">
            x
          </button>
        </div>

        <form
          className="support-ticket-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) {
              return;
            }

            void mutation.mutateAsync({
              subject,
              message,
              priority,
              contextType,
              contextId: contextId ?? null,
              contextSnapshot: contextSnapshot ?? null,
            });
          }}
        >
          <label>
            <span>Subject</span>
            <input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={160} />
          </label>

          <label>
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value as SupportTicketPriority)}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
            </select>
          </label>

          <label>
            <span>Message</span>
            <textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Describe what you need help with."
              rows={5}
              maxLength={2000}
            />
          </label>

          <div className="support-context-note">
            Context: {contextType}{contextId ? ` · ${contextId}` : ''}
          </div>

          {mutation.isError ? <p className="action-feedback action-error">{getErrorMessage(mutation.error)}</p> : null}
          {successMessage ? <p className="action-feedback action-success">{successMessage}</p> : null}

          <div className="support-modal-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>
              Close
            </button>
            <button type="submit" className="button button-primary" disabled={!canSubmit}>
              {mutation.isPending ? 'Sending...' : 'Create ticket'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
