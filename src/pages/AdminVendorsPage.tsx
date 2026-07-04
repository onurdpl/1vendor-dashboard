import { FormEvent, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { provisionVendor } from '../lib/api/vendors';
import type { VendorProvisioningInput, VendorProvisioningResult } from '../lib/api/contracts';

type VendorProvisioningFormState = VendorProvisioningInput;

const initialFormState: VendorProvisioningFormState = {
  vendorId: '',
  vendorName: '',
  adminName: '',
  adminEmail: '',
  restrictionReason: '',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function trimForm(state: VendorProvisioningFormState): VendorProvisioningInput {
  return {
    vendorId: state.vendorId.trim(),
    vendorName: state.vendorName.trim(),
    adminName: state.adminName.trim(),
    adminEmail: state.adminEmail.trim(),
    restrictionReason: state.restrictionReason.trim(),
  };
}

function validateForm(input: VendorProvisioningInput) {
  if (!input.vendorId || !input.vendorName || !input.adminName || !input.adminEmail || !input.restrictionReason) {
    return 'All fields are required.';
  }

  if (!EMAIL_PATTERN.test(input.adminEmail)) {
    return 'Admin email must be a valid email address.';
  }

  return null;
}

function getSafeErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return 'Vendor could not be provisioned.';
}

export function AdminVendorsPage() {
  const navigate = useNavigate();
  const [form, setForm] = useState<VendorProvisioningFormState>(initialFormState);
  const [formError, setFormError] = useState<string | null>(null);
  const [success, setSuccess] = useState<VendorProvisioningResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const trimmedPreview = useMemo(() => trimForm(form), [form]);

  function updateField(field: keyof VendorProvisioningFormState, value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setFormError(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = trimForm(form);
    const validationError = validateForm(input);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      const result = await provisionVendor(input);
      setSuccess(result);
      setForm({
        vendorId: input.vendorId,
        vendorName: input.vendorName,
        adminName: input.adminName,
        adminEmail: input.adminEmail,
        restrictionReason: input.restrictionReason,
      });
    } catch (error) {
      setSuccess(null);
      setFormError(getSafeErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="op-page admin-vendors-page">
      <div className="op-page-heading">
        <div>
          <p className="eyebrow">Admin Workspace</p>
          <h1>Create Vendor</h1>
          <p>Provision a marketplace seller account and initial vendor admin without seed data.</p>
        </div>
      </div>

      <div className="admin-vendor-provisioning-layout">
        <form className="admin-vendor-provisioning-card" onSubmit={handleSubmit} noValidate>
          <div className="admin-vendor-provisioning-heading">
            <div>
              <h2>Vendor account</h2>
              <p>Vendor starts restricted until setup is complete.</p>
            </div>
            <span className="severity-chip severity-attention">Restricted start</span>
          </div>

          <div className="field">
            <label htmlFor="vendor-provisioning-vendor-id">Vendor ID</label>
            <input
              id="vendor-provisioning-vendor-id"
              type="text"
              value={form.vendorId}
              onChange={(event) => updateField('vendorId', event.target.value)}
              autoComplete="off"
              required
            />
            <span className="field-help">Vendor ID must match Shopify seller_info.</span>
          </div>

          <div className="field">
            <label htmlFor="vendor-provisioning-vendor-name">Vendor name</label>
            <input
              id="vendor-provisioning-vendor-name"
              type="text"
              value={form.vendorName}
              onChange={(event) => updateField('vendorName', event.target.value)}
              autoComplete="organization"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="vendor-provisioning-admin-name">Admin name</label>
            <input
              id="vendor-provisioning-admin-name"
              type="text"
              value={form.adminName}
              onChange={(event) => updateField('adminName', event.target.value)}
              autoComplete="name"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="vendor-provisioning-admin-email">Admin email</label>
            <input
              id="vendor-provisioning-admin-email"
              type="email"
              value={form.adminEmail}
              onChange={(event) => updateField('adminEmail', event.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div className="field">
            <label htmlFor="vendor-provisioning-restriction-reason">Restriction reason</label>
            <textarea
              id="vendor-provisioning-restriction-reason"
              value={form.restrictionReason}
              onChange={(event) => updateField('restrictionReason', event.target.value)}
              rows={4}
              required
            />
          </div>

          <div className="admin-vendor-provisioning-note">
            <strong>Before you submit</strong>
            <p>Temporary password will be shown once after creation.</p>
            <p>Admin must complete setup before activating vendor.</p>
          </div>

          {formError ? (
            <p className="admin-vendor-provisioning-error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitting ? 'Creating vendor...' : 'Create Vendor'}
          </button>
        </form>

        <aside className="admin-vendor-provisioning-side">
          {success ? (
            <div className="admin-vendor-provisioning-success" role="status" aria-live="polite">
              <p className="eyebrow">Vendor provisioned</p>
              <h2>{success.vendorName}</h2>
              <dl>
                <div>
                  <dt>Vendor ID</dt>
                  <dd>{success.vendorId}</dd>
                </div>
                <div>
                  <dt>Admin email</dt>
                  <dd>{success.adminEmail}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>{success.vendorStatus}</dd>
                </div>
              </dl>
              <div className="admin-vendor-temporary-password">
                <span>Temporary password</span>
                <strong>{success.temporaryPassword}</strong>
              </div>
              <p className="admin-vendor-password-warning">
                Copy this password now. It will not be shown again.
              </p>
              <button
                type="button"
                className="button button-primary"
                onClick={() => navigate('/vendor/profile')}
              >
                Open Vendor Profile
              </button>
            </div>
          ) : (
            <div className="admin-vendor-provisioning-guide">
              <p className="eyebrow">Setup model</p>
              <h2>Restricted first</h2>
              <p>
                The vendor is created in restricted mode so sellers can sign in and view their workspace while setup is
                completed by the Marketplace team.
              </p>
              <dl>
                <div>
                  <dt>Vendor ID</dt>
                  <dd>{trimmedPreview.vendorId || 'Waiting for input'}</dd>
                </div>
                <div>
                  <dt>Initial admin</dt>
                  <dd>{trimmedPreview.adminEmail || 'Waiting for input'}</dd>
                </div>
              </dl>
              <Link className="button button-secondary" to="/admin/operations">
                Back to Operations
              </Link>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
