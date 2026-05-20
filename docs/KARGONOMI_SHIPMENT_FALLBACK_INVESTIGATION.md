# Kargonomi Shipment Fallback Investigation

## Root Cause

Kargonomi shipment execution was blocked before the adapter could call Kargonomi.

The create flow requires Kargonomi buyer location ids:

- `buyer_state_id`
- `buyer_city_id`

The Kargonomi payload builder can read these from the order record or from vendor `providerMetadata`, but the admin config UI only exposed:

- provider
- warehouse id
- default desi

That made a config with `provider=kargonomi` and warehouse `112668` look usable while the actual create path still failed validation before provider execution.

## Exact Failure Point

Flow:

1. Vendor clicks `Create shipment`.
2. Frontend calls `POST /shipments/create`.
3. Backend enters `createShipmentExecution`.
4. `buildShipmentRequestPreview` selects `provider=kargonomi`.
5. `buildKargonomiBuyer` cannot resolve `buyer_state_id` / `buyer_city_id`.
6. Backend throws `Missing required shipment fields: buyer.buyer_state_id, buyer.buyer_city_id`.
7. Kargonomi adapter is not called.
8. `POST /shipments` is not sent to Kargonomi.
9. No shipment execution record is persisted because validation failed during preview.
10. The UI still shows the existing manual tracking form because no shipment/tracking exists.

## What Changed

- Kargonomi readiness now reports missing buyer state/city ids.
- Admin config editor now exposes:
  - Kargonomi warehouse ID
  - Kargonomi buyer state ID
  - Kargonomi buyer city ID
- Kargonomi provider metadata saves:
  - `kargonomiBuyerStateId`
  - `kargonomiBuyerCityId`
- Readiness stays not ready until warehouse, default desi, buyer state id, and buyer city id are configured.

## Non-Changes

- No shipment was created.
- No Kargonomi API flow was modified.
- No Try OTO behavior was modified.
- No return/reverse logic was modified.
- No automatic retry was added.

## Remaining Unknowns

The correct Kargonomi numeric state/city ids for each destination remain operational data. The current patch supports static provider metadata fallback for the PoC, but a production-grade implementation should eventually map Shopify destination city/state to Kargonomi ids per order.
