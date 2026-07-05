# Vendor Provisioning Architecture

## Purpose

This document is the source of truth for the Vendor Provisioning lifecycle.

Vendor Provisioning means the admin-controlled flow that creates a marketplace seller, creates the first vendor admin user, links that user to the vendor, starts the vendor in restricted mode, and then uses Admin Vendor Profile to complete launch setup before activation.

This document owns only Vendor Provisioning. It does not own vendor-facing product tone, finance architecture, provider API contracts, audit-log schema details, Shopify ingestion, or restricted-mode enforcement internals.

Related source documents:

- Product principles: `docs/product/SPORGYM_PRODUCT_SPECIFICATION.md`
- Role-aware profile/readiness presentation: `docs/ROLE_AWARE_OPERATIONAL_MODEL.md`
- Vendor Integration API contract: `docs/VENDOR_INTEGRATION_API.md`
- Vendor Profile audit behavior: `docs/VENDOR_PROFILE_AUDIT_LOGS.md`

## Source Of Truth Status

This document is authoritative for:

- admin-driven vendor provisioning
- the launch provisioning lifecycle
- initial vendor admin creation
- `UserVendorAccess` creation
- temporary password handling
- restricted-first onboarding
- `/admin/vendors/:vendorId` as the admin onboarding workspace
- activation prerequisites and activation rule

If another document describes the same lifecycle differently, this document wins. Secondary documents should link here instead of duplicating the full lifecycle.

## Admin-Driven Provisioning Lifecycle

The launch lifecycle is:

```text
Admin
-> Create Vendor
-> Vendor
-> Vendor Admin User
-> UserVendorAccess
-> Temporary Password (shown once)
-> /admin/vendors/:vendorId
-> Vendor Profile
-> Billing
-> Shipping
-> Finance
-> Integration
-> Activate Vendor
-> Vendor begins operating
```

The vendor is created by marketplace admins. Vendor self-signup is not part of the launch model.

The admin provisioning entry point is:

```http
POST /admin/vendors/provision
```

The admin UI entry point is:

```text
/admin/vendors/new
```

After successful provisioning, the admin opens:

```text
/admin/vendors/:vendorId
```

## Creation Model

Provisioning creates the minimum launch records needed for a new vendor account.

### Vendor

The Vendor record is the current truth for the seller account.

Required launch inputs:

- `vendorId`
- `vendorName`
- `restrictionReason`

Initial launch status:

- `status = inactive`
- `restrictionReason` is stored on the Vendor
- `restrictedByUserId` is set from the admin actor when available
- `restrictedAt` is set at provisioning time

### User

Provisioning creates the first vendor admin user.

Required launch inputs:

- `adminName`
- `adminEmail`

Initial user state:

- role is vendor
- user status is active
- password is stored only as a password hash

The vendor may sign in while the Vendor account itself remains restricted.

### UserVendorAccess

Provisioning creates one access link from the new vendor admin user to the new Vendor.

This is the access bridge that lets the provisioned user enter the vendor workspace for the correct seller.

## Temporary Password One-Time Behavior

Provisioning returns a temporary password once.

Rules:

- The plaintext password is returned only in the provisioning response.
- The plaintext password must be shown once in the admin UI.
- The admin UI must warn the admin to copy it immediately.
- The plaintext password must not be stored in localStorage or sessionStorage.
- The plaintext password must not be logged.
- The backend stores only the password hash.

Password reset and invite-token flows are not part of the launch provisioning model.

## Restricted-First Launch Policy

New vendors start restricted.

Restricted vendors may:

- sign in
- view their workspace data
- view orders
- view returns
- view finance
- contact support
- receive an onboarding Vendor Integration API token created by an admin

Restricted vendors must not perform operational write actions until activation.

Restricted-mode enforcement is owned by the restricted vendor authorization model. This document owns the provisioning decision that newly provisioned vendors start restricted.

## Admin Vendor Profile Onboarding Workspace

`/admin/vendors/:vendorId` is the admin onboarding workspace for a specific vendor.

It must load the requested route vendor, not the current session vendor.

The existing vendor self-profile route remains:

```text
/vendor/profile
```

Vendor self-profile remains vendor-scoped and does not provide admin onboarding controls.

## Vendor Profile Onboarding Responsibilities

Admin Vendor Profile owns launch setup for the selected vendor.

### Billing

Billing setup owns the vendor legal and billing identity used by marketplace finance and commission invoice readiness.

It includes the admin-managed billing/legal profile and Logo Isbasi customer code where applicable.

### Shipping

Shipping setup owns the admin-managed shipping configuration for future shipment and return-provider workflows.

It includes provider selection, shipping enabled state, warehouse/default sender details, cargo integration identifiers, default desi, shipping VAT, and provider metadata supported by the existing shipping editor.

### Finance

Finance setup owns the current vendor finance policy for future finance ledger rows.

It includes commission, commission VAT, shipping deduction policy, fixed shipping fee when used, settlement delay, settlement frequency, and stored automation preferences.

Finance policy changes do not rewrite historical ledger rows, approved settlements, invoices, or payouts.

### Integration

Integration setup owns the onboarding Vendor Integration API token creation action for the selected vendor.

Admin Vendor Profile may create an onboarding token for restricted vendors. The token can be used for read access immediately, while operational write endpoints remain blocked until vendor activation.

Provider Management remains the place to list, inspect, and revoke existing provider tokens. Admin Vendor Profile is the onboarding place to create a token for the selected vendor.

### Status / Activation

Status setup owns the vendor account status control.

Restricted status requires a reason. Active status does not require a restriction reason.

Activation changes the Vendor current status to active and clears current restriction fields. Audit history remains append-only.

## Shopify `seller_info` / Vendor ID Compatibility

Vendor ID is the identifier that must match Shopify `seller_info` after current ingestion normalization.

Launch rule:

- Admin-entered Vendor IDs must be lowercase.
- Vendor IDs may use letters, numbers, hyphen, and underscore.
- Vendor IDs must not include path separators.
- Vendor IDs must not include control characters.

No alternate Shopify seller matching behavior is introduced by provisioning.

## Activation Rule

Admin may activate the vendor after required launch setup is complete.

Launch setup means the selected vendor has sufficient current configuration for:

- billing
- shipping
- finance
- integration
- status

Activation is not automatic. Activation is an explicit admin action from Admin Vendor Profile.

After activation:

- the vendor account status is active
- current restriction reason is cleared
- current restricted-by value is cleared
- current restricted-at value is cleared
- vendor operational write actions may proceed according to normal permissions, scopes, ownership, and business rules

## Audit And Logging Expectations

Provisioning must write audit evidence for the initial vendor status.

Admin-owned Vendor Profile changes must remain auditable through the existing append-only Vendor Profile audit log model.

At minimum, provisioning and onboarding-related changes should preserve:

- vendor
- changed field or action
- actor when available
- timestamp
- reason when required
- safe display values

Vendor Integration token creation must follow the Vendor Integration API audit and security rules. Plaintext tokens must not appear in audit logs.

## Non-Goals

The following are not part of launch Vendor Provisioning:

- vendor self-signup
- invite flow
- password reset
- multi-user vendor management
- advanced onboarding wizard
- automatic provider provisioning
- automatic Shopify seller matching beyond Vendor ID / `seller_info` compatibility
- automatic activation
- bank, payment, or payout execution
- provider token generation outside the existing Vendor Integration API token creation flow
