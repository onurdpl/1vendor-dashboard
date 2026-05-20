# Kargonomi Provider UI/Config Mismatch Investigation

## Root Cause

The backend provider execution/config model already knew about `kargonomi`, but the admin diagnostics route and frontend config contract were still partially limited to the earlier provider list.

Confirmed mismatch points:

- `SHIPPING_PROVIDER=kargonomi` was accepted by backend env parsing.
- Prisma `ShippingProvider` includes `KARGONOMI`.
- Backend readiness diagnostics can compute Kargonomi readiness.
- The admin diagnostics route only accepted `kargo_entegrator` and `try_oto` query overrides, so `provider=kargonomi` was discarded and the route fell back to the env/default path.
- Frontend `ShippingProvider`/diagnostics types did not include `kargonomi`.
- The admin provider dropdown did not render Kargonomi even when backend diagnostics supported it.
- The display label helper did not explicitly map `kargonomi` to `Kargonomi`.

## Stored Config Observation

The existing vendor shipping config can still contain the old Kargo Entegrator warehouse value `1774`. That explains why the admin card may show `1774` even when Render env has `SHIPPING_PROVIDER=kargonomi`.

This is stored vendor configuration, not a Kargonomi API behavior issue. This patch does not migrate or delete existing config. Admins can now select Kargonomi and save a Kargonomi warehouse id such as `112668` or `112666`.

## Fix Scope

- Allow the admin diagnostics route to pass through `provider=kargonomi`.
- Add Kargonomi to frontend provider/diagnostics types.
- Add Kargonomi to the admin provider dropdown when backend diagnostics expose it.
- Show a Kargonomi warehouse ID field when Kargonomi is selected.
- Render `kargonomi` as `Kargonomi`.
- Keep Try OTO return/status controls gated to actual Try OTO shipment executions.

## Non-Changes

- No shipment was created.
- No Kargonomi API flow was modified.
- No Try OTO behavior was modified.
- No return/reverse flow was implemented.
- No existing vendor shipping config was migrated.
