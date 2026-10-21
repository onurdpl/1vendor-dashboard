import { useEffect, useState } from 'react';
import { OperationalSection } from './OperationalPrimitives';
import { getVendorPasswordResetOperation, listVendorLoginUsers, resetVendorUserPassword } from '../features/vendors/api';
import type { VendorLoginUser, VendorPasswordResetResult } from '../lib/api/contracts';
import { ApiError } from '../lib/api/errors';

type PendingOperation = { operationId: string; targetUserId: string };

function pendingKey(vendorId: string) { return `admin-password-reset-pending:${vendorId}`; }

function readPending(vendorId: string): PendingOperation | null {
  try {
    const raw = sessionStorage.getItem(pendingKey(vendorId));
    if (!raw) return null;
    const value = JSON.parse(raw) as PendingOperation;
    return typeof value.operationId === 'string' && typeof value.targetUserId === 'string' ? value : null;
  } catch { return null; }
}

function savePending(vendorId: string, pending: PendingOperation | null) {
  try {
    if (pending) sessionStorage.setItem(pendingKey(vendorId), JSON.stringify(pending));
    else sessionStorage.removeItem(pendingKey(vendorId));
  } catch { /* No credential is persisted; the operation can still be checked during this visit. */ }
}

export function AdminVendorPasswordResetSection({ vendorId }: { vendorId: string }) {
  const [users, setUsers] = useState<VendorLoginUser[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [selected, setSelected] = useState<VendorLoginUser | null>(null);
  const [success, setSuccess] = useState<VendorPasswordResetResult | null>(null);
  const [pending, setPending] = useState<PendingOperation | null>(() => readPending(vendorId));
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function refreshUsers(signal?: AbortSignal) {
    const result = await listVendorLoginUsers(vendorId, { signal });
    setUsers(result.users);
    setLoadError(false);
  }

  useEffect(() => {
    const controller = new AbortController();
    setUsers(null);
    setLoadError(false);
    setSelected(null);
    setSuccess(null);
    setPending(readPending(vendorId));
    void refreshUsers(controller.signal).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    });
    return () => controller.abort();
  }, [vendorId]);

  async function checkOperation() {
    if (!pending) return;
    try {
      await getVendorPasswordResetOperation(vendorId, pending.operationId);
      setMessage('The reset committed, but its one-time password cannot be recovered. Confirm a new reset if needed.');
      setPending(null);
      savePending(vendorId, null);
      void refreshUsers().catch(() => setLoadError(true));
    } catch {
      setMessage('Reset outcome is not confirmed. Do not submit it again; check this operation after connectivity is restored.');
    }
  }

  async function executeReset() {
    if (!selected || submitting || pending) return;
    const operation = { operationId: crypto.randomUUID(), targetUserId: selected.userId };
    setPending(operation);
    savePending(vendorId, operation);
    setSubmitting(true);
    setMessage(null);
    try {
      const result = await resetVendorUserPassword(vendorId, selected.userId, {
        operationId: operation.operationId, expectedCredentialVersion: selected.credentialVersion,
      });
      setSuccess(result);
      setSelected(null);
      setPending(null);
      savePending(vendorId, null);
      void refreshUsers().catch(() => setLoadError(true));
    } catch (error) {
      setSelected(null);
      const code = error instanceof ApiError && error.details && typeof error.details === 'object' &&
        'code' in error.details ? error.details.code : null;
      if (error instanceof ApiError && error.status === 409 && code === 'credential_version_conflict') {
        setPending(null);
        savePending(vendorId, null);
        setMessage('This user’s credentials changed. No reset was performed by this request. Review the current user state before confirming another reset.');
        void refreshUsers().catch(() => setLoadError(true));
      } else {
        setMessage('Reset outcome is uncertain. Check the operation before any new reset.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OperationalSection title="Vendor login credentials" description="Admin-only password reset for an existing vendor login.">
      {loadError ? <p role="alert">Login users could not be loaded. <button type="button" onClick={() => void refreshUsers().catch(() => setLoadError(true))}>Retry</button></p> : null}
      {users === null && !loadError ? <p>Loading login users…</p> : null}
      {users?.length === 0 ? <p>No linked login users.</p> : null}
      {users?.map((user) => (
        <div className="operational-card" key={user.userId}>
          <strong>{user.name}</strong> <span>{user.email}</span>
          <p>{user.role} · {user.status} · {user.vendorMembershipCount} vendor membership{user.vendorMembershipCount === 1 ? '' : 's'}</p>
          <button type="button" className="button button-secondary"
            disabled={!user.resetEligible || submitting || Boolean(pending)}
            onClick={() => { setSuccess(null); setMessage(null); setSelected(user); }}>
            Generate New Temporary Password
          </button>
          {!user.resetEligible ? <p>{user.ineligibilityReason === 'target_not_vendor'
            ? 'Only VENDOR users can be reset.' : 'Users linked to multiple vendors cannot be reset here.'}</p> : null}
        </div>
      ))}
      {selected ? (
        <div role="dialog" aria-label="Confirm password reset" className="operational-card">
          <h3>Confirm password reset</h3>
          <p>{selected.name} ({selected.email}) · Vendor ID: {vendorId}</p>
          <p>The existing password will stop working and all existing sessions will be invalidated.</p>
          <button type="button" className="button button-primary" disabled={submitting} onClick={() => void executeReset()}>
            {submitting ? 'Resetting…' : 'Confirm reset'}
          </button>
          <button type="button" className="button button-secondary" disabled={submitting} onClick={() => setSelected(null)}>Cancel</button>
        </div>
      ) : null}
      {pending && !submitting ? <div role="status">
        <p>Operation {pending.operationId} has an unconfirmed outcome. Do not repeat the request.</p>
        <button type="button" onClick={() => void checkOperation()}>Check reset status</button>
      </div> : null}
      {message ? <p role="alert">{message}</p> : null}
      {success ? <div role="status" className="operational-card">
        <h3>One-time temporary password</h3>
        <p>Vendor ID: {success.vendorId} · User: {users?.find((user) => user.userId === success.targetUserId)?.email ?? success.targetUserId}</p>
        <code>{success.temporaryPassword}</code>
        <button type="button" onClick={() => {
          if (!navigator.clipboard?.writeText) {
            setMessage('Copy is unavailable. Save the displayed password securely before leaving this page.');
            return;
          }
          void navigator.clipboard.writeText(success.temporaryPassword).catch(() => {
            setMessage('Copy failed. Save the displayed password securely before leaving this page.');
          });
        }}>Copy password</button>
        <p>Save this password securely now. It will not be shown again after leaving or refreshing this page.</p>
        <button type="button" onClick={() => setSuccess(null)}>Dismiss password</button>
      </div> : null}
    </OperationalSection>
  );
}
