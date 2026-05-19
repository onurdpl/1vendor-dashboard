# Shipment and Return Support Tooling

## Purpose

The support workflow gives vendors a simple way to raise shipment, tracking, label, delivery, and return issues while preserving admin-only operational diagnostics. Support tickets are attached to the current order or shipment context and appear in the unified operational timeline.

## Lifecycle

1. Vendor opens **Contact support** from Order Detail.
2. Vendor selects a category, optionally adds a note, and submits the ticket.
3. The platform stores a support ticket with status `open`.
4. Admins review the ticket, attached operational context, and safe diagnostic summaries.
5. Admins can add internal notes, reply to the vendor, move the ticket through investigation, resolve it, or close it.
6. Ticket creation, replies, and resolved/closed states are reflected in the Order Detail timeline.

## Vendor Permissions

Vendors can:

- Open support tickets for assigned active or fulfilled orders.
- Select shipment, return, tracking, label, delivery, or other support categories.
- Add an optional operational note.
- See vendor-safe support ticket history and replies.

Vendors must not see:

- Raw provider payloads.
- API keys, tokens, auth headers, or webhook internals.
- Shopify GraphQL request or mutation details.
- Stack traces or internal exception data.
- Cross-vendor support or shipment context.

## Admin Permissions

Admins can:

- See support ticket summaries linked to Order Detail.
- Review admin-only context snapshots and internal notes.
- Copy safe shipment, return, and Shopify diagnostic summaries for investigation.
- See provider response summaries, webhook status, Try OTO return diagnostics, and Shopify reverse delivery probe summaries when available.

Admin diagnostics are intentionally summarized. They should describe field presence, status, IDs-present booleans, response keys, and provider messages without exposing raw payloads or customer-sensitive data.

## Attached Context

Vendor-safe context includes:

- Order number.
- Shipment provider and carrier.
- Tracking number and tracking-link presence.
- Return order id when available.
- Shipment and return status.
- Shopify fulfillment sync state.
- Timestamp.
- Vendor/store identifier.
- Support correlation id.

Admin-only context may additionally include:

- Provider HTTP status and response keys.
- Provider error/message summary.
- Webhook received/status summary.
- Try OTO return response summary.
- Shopify reverse delivery probe summary.

## Diagnostic Copy Safety

Copy actions must produce clean operational text only. They must not include:

- Raw request or response payload dumps.
- Customer phone, address, email, or full customer payloads.
- API keys, tokens, auth headers, webhook HMACs, or secrets.
- Unredacted Shopify GraphQL variables.

## Future Hooks

Potential follow-up phases:

- Support ticket assignment automation.
- Email notifications for vendor replies.
- SLA-based escalation queues.
- Return-label-specific support templates.
- Provider-specific troubleshooting checklists.
