# Operational Workspace Blueprint

This document defines the vendor-facing operational workspace architecture for Sporgym.

It applies to:

- Orders
- Returns

It does not apply to:

- Dashboard
- Finance
- Support
- Products
- Settings
- Admin operations

Orders and Returns are operational work queues. They are not dashboards, reports, analytics pages, or accounting surfaces. Their job is to help a marketplace vendor move through daily work quickly, confidently, and without losing context.

This blueprint follows `docs/product/SPORGYM_PRODUCT_SPECIFICATION.md` and the Operational State Model audit. If a future implementation conflicts with this document or the product specification, the product specification wins.

## Purpose

Orders and Returns must share one operational architecture because vendors use them with the same mental model:

1. Choose the kind of work they are doing.
2. Narrow that work with filters.
3. Scan a dense operational list.
4. Select one item.
5. Act from a persistent detail panel without losing the list.

The workspace exists to answer:

- What work needs attention?
- What should I do next?
- Why is this item blocked or waiting?
- What is the current operational status?
- What evidence is available if I need detail?

The workspace must not expose internal implementation concepts as the primary experience. Backend terms such as allocation, ledger, canonical reconciliation, webhook, idempotency, or internal identifiers belong only in admin or deep diagnostic contexts.

## Layout

The required hierarchy is:

```text
Workflow Tabs
↓
Advanced Filters
↓
Quick Filters
↓
Operational Table
↓
Persistent Right Detail Panel
```

This hierarchy exists because each layer has a different job.

### 1. Workflow Tabs

Workflow tabs define the seller's primary work mode. They answer:

> What kind of work am I doing right now?

Workflow tabs are not ordinary filters. They are the top-level operational state of the workspace.

Examples:

- Orders waiting for shipment
- Orders blocked from fulfillment
- Returns waiting for review
- Returns already refunded

Workflow tabs should be stable, few, and ordered by daily seller workflow. They should not be created for every backend status.

### 2. Advanced Filters

Advanced filters help the seller investigate or locate specific records inside the selected workflow.

They answer:

> I know what kind of work I am doing. How do I narrow the list?

Advanced filters include lookup and investigation controls such as search, date, customer, order number, carrier, tracking number, return reason, vendor scope where relevant, and operational status refinements.

Advanced filters should not replace workflow tabs.

### 3. Quick Filters

Quick filters are lightweight refinements inside the current workflow.

They answer:

> Within this workflow, which subset should I inspect first?

Quick filters must never become a second competing workflow model. They should be optional, contextual, and easy to clear.

Examples:

- Tracking missing
- High value
- Today
- This week
- Customer note present
- Multiple items

### 4. Operational Table

The table is the primary scanning surface. It must remain visible and stable while the seller works.

The table answers:

> Which item should I open next?

Operational tables are appropriate here because Orders and Returns require comparison across many records. The table should prioritize action, status, and context over internal evidence.

### 5. Persistent Right Detail Panel

The right detail panel is a core differentiator of the operational workspace. It lets the seller inspect and act without leaving the work queue.

The panel answers:

> What is happening with this item, and what should I do now?

It must remain persistent on desktop and should have a safe responsive equivalent on smaller screens. It should not be removed in favor of full-page navigation unless the device size requires it.

## Workflow Tabs

Workflow tabs must use existing operational states and projections. Do not invent new backend states just to support tab labels.

Tabs should be seller-facing labels mapped to current state evidence.

### Orders Workflow Tabs

Recommended order:

1. Needs Action
2. Ready to Ship
3. In Progress
4. Blocked
5. Completed
6. All

#### Needs Action

Purpose:
Shows orders that require a vendor decision or vendor action.

Seller mindset:
"What must I handle first?"

Seller enters this state when:

- An order is waiting for shipment work.
- Shipment information is missing.
- A return or exception is linked to the order and requires attention.
- A vendor-visible action is required.

Seller leaves this state when:

- The next action is completed.
- The order moves into shipment progress, blocked resolution, refunded, or completed state.

#### Ready to Ship

Purpose:
Shows orders that are fulfillable and waiting for shipment preparation.

Seller mindset:
"What should I ship next?"

Seller enters this state when:

- Fulfillment is allowed.
- Shipment work has not been completed.
- The order is not blocked, refunded, or terminal.

Seller leaves this state when:

- Shipment is created.
- Tracking moves into progress.
- The order becomes blocked, refunded, cancelled, or otherwise not fulfillable.

#### In Progress

Purpose:
Shows orders already moving through fulfillment.

Seller mindset:
"Which shipments are underway?"

Seller enters this state when:

- Shipping has started.
- Tracking, label, carrier, or delivery progress exists.

Seller leaves this state when:

- The order is delivered or completed.
- An exception moves it to Blocked or Needs Action.

#### Blocked

Purpose:
Shows orders that cannot continue normal shipment work.

Seller mindset:
"Why can this not be fulfilled, and who needs to resolve it?"

Seller enters this state when:

- Vendor blocked state exists.
- Admin resolution is required.
- Shipment is unavailable.
- Fulfillment is blocked by a valid operational state.

Seller leaves this state when:

- Transfer completes.
- Refund resolves the assignment.
- Admin resolution returns the order to a fulfillable state.
- The order becomes terminal.

#### Completed

Purpose:
Shows orders whose operational workflow is finished.

Seller mindset:
"What has already been handled?"

Seller enters this state when:

- Delivery is complete.
- Fulfillment is no longer required because the order or assignment was refunded.
- The order is terminal and has no vendor action remaining.

Seller leaves this state when:

- Usually never. If a return or issue opens, the related return/support workflow should carry the new work.

#### All

Purpose:
Provides a full list for lookup and investigation.

Seller mindset:
"Find a known order or review everything."

Seller enters this state when:

- Searching by order number, customer, tracking number, or broad history.

Seller leaves this state when:

- They choose a focused workflow tab.

### Returns Workflow Tabs

Recommended order:

1. Needs Action
2. Awaiting Review
3. In Progress
4. Refunded
5. Closed
6. All

#### Needs Action

Purpose:
Shows returns requiring vendor attention now.

Seller mindset:
"Which returns do I need to handle?"

Seller enters this state when:

- A return needs review.
- Vendor shipment or receiving action is required.
- Refund or return processing requires vendor-facing action.

Seller leaves this state when:

- The vendor completes the required action.
- Responsibility moves to admin or settlement/accounting review.
- The return becomes refunded or closed.

#### Awaiting Review

Purpose:
Shows requested returns that are waiting for review or decision.

Seller mindset:
"Which requests need evaluation?"

Seller enters this state when:

- A return request is pending review.
- Return approval or vendor response is not complete.

Seller leaves this state when:

- The return is approved, declined, received, refunded, or closed.

#### In Progress

Purpose:
Shows returns moving through shipment, receipt, inspection, or refund preparation.

Seller mindset:
"Which returns are underway?"

Seller enters this state when:

- Return shipping is in progress.
- Returned items are expected or received.
- Refund processing is underway but not terminal.

Seller leaves this state when:

- Refund completes.
- Return closes without refund.
- A blocking issue requires attention.

#### Refunded

Purpose:
Shows returns where the refund has completed.

Seller mindset:
"Which returns have been refunded?"

Seller enters this state when:

- Refund evidence exists.
- Refund has been processed and the return no longer needs operational action.

Seller leaves this state when:

- Usually never. Any later accounting review should be shown in Finance, not as a return operation unless vendor action is required.

#### Closed

Purpose:
Shows terminal returns with no remaining vendor action.

Seller mindset:
"Which return cases are finished?"

Seller enters this state when:

- Return workflow is closed.
- Declined, cancelled, refunded, or completed outcomes are final.

Seller leaves this state when:

- Usually never, unless a support/admin process reopens the case.

#### All

Purpose:
Provides complete lookup and investigation.

Seller mindset:
"Find a known return or inspect return history."

Seller enters this state when:

- Searching by order, return reference, customer, SKU, tracking number, or broad history.

Seller leaves this state when:

- They choose a focused return workflow.

## Advanced Filters

Advanced filters belong below workflow tabs because they refine a chosen work mode. They should be practical, predictable, and vendor-facing.

### Lookup Tools

Lookup tools help find a known record.

Orders:

- Order number
- Customer
- SKU or barcode, if available
- Tracking number
- Carrier
- Date range

Returns:

- Return reference
- Order number
- Customer
- SKU or barcode, if available
- Tracking number
- Date range

### Investigation Tools

Investigation tools help explain or narrow a workflow.

Orders:

- Operational status
- Shipment status
- Payment status
- Carrier
- Date range
- Amount range, if available and useful

Returns:

- Return status
- Refund status
- Return reason
- Carrier
- Date range
- Amount range, if available and useful

### Admin-Only or Contextual Filters

These may appear only where permissions and product context allow:

- Vendor
- Source
- Internal status
- Sync status
- Diagnostic references

Vendor-facing first-level UI should not expose admin diagnostics by default.

## Quick Filters

Quick filters refine the current workflow tab. They are not tabs and must not compete with workflow tabs.

A quick filter qualifies if:

- It narrows the current workflow without changing the work mode.
- It can be understood in one or two words.
- It can be cleared easily.
- It is useful for repeated daily scanning.
- It does not require explaining internal state.

Orders examples:

- Today
- Tracking missing
- Missing carrier
- High value
- Customer note
- Returned item linked

Returns examples:

- Today
- This week
- Refund pending
- Tracking missing
- Customer note
- Multiple items

Quick filters should not be used for:

- Awaiting shipment
- Vendor blocked
- Refunded
- Closed
- Completed

Those are workflow states because they define what kind of work the seller is doing.

## Operational Table

The table is the main work surface. It should optimize scanning and selection.

### Canonical Orders Table

Recommended column order:

1. Order
2. Customer
3. Operational Status
4. Shipment
5. Payment
6. Next Action

Required columns:

- Order: order number, creation date or age, and concise identifier.
- Customer: customer name and useful location/contact context when available.
- Operational Status: canonical seller-facing state such as Ready to ship, Blocked, In progress, Refunded, Completed.
- Next Action: the most important next step, such as Prepare shipment, Review blocked order, No action required.

Optional columns:

- Shipment: carrier/tracking/delivery progress, only when it helps the workflow.
- Payment: payment/refund status, concise and not accounting-heavy.
- Amount: only if it helps operational prioritization or high-value scanning.

Columns that should never exist in vendor first-level Orders table:

- Allocation ID
- Webhook ID
- Canonical reconciliation status
- Raw fulfillment order ID
- Ledger ID
- Diagnostic ID as primary label
- Internal enum-only status without plain-language label

### Canonical Returns Table

Recommended column order:

1. Return
2. Order
3. Customer
4. Return Status
5. Refund Status
6. Next Action

Required columns:

- Return: return reference, request date or age, and concise context.
- Order: related order number.
- Return Status: requested, awaiting review, in progress, refunded, closed, or similar seller-facing state.
- Next Action: review request, wait for item, process received return, no action required, or similar.

Optional columns:

- Customer
- Items
- Refund status
- Return shipment
- Reason
- Amount, only if useful and not distracting.

Columns that should never exist in vendor first-level Returns table:

- Return internal ID as primary label
- Refund internal ID as primary label
- Allocation ID
- Webhook ID
- Raw reconciliation status
- Ledger ID
- Internal enum-only status without plain-language label

## Persistent Right Detail Panel

The right detail panel must remain part of the operational architecture. It preserves list context while giving enough detail to act.

### Canonical Hierarchy

```text
Summary
↓
Next Action
↓
Operational Details
↓
Items
↓
Payment
↓
Timeline
↓
Evidence
```

### Summary

Purpose:
Confirm what the selected item is and its current state.

Orders should show:

- Order number
- Customer
- Operational status
- Payment status
- Short state explanation

Returns should show:

- Return reference
- Related order
- Return status
- Refund status
- Short state explanation

### Next Action

Purpose:
Make the next step obvious.

This section should be near the top because operational pages exist for action. It should show one primary action and quieter secondary actions only when needed.

Examples:

- Prepare shipment
- Review blocked order
- Review return request
- No action required

### Operational Details

Purpose:
Explain why the item is in its current workflow state.

Orders may include:

- Shipment state
- Fulfillment availability
- Blocked reason
- Admin resolution status where vendor-visible

Returns may include:

- Return request state
- Shipping/receiving state
- Ownership or responsibility
- Refund processing state

### Items

Purpose:
Show what products are affected.

Orders may include assigned items, quantities, SKU/title, and fulfillment readiness.

Returns may include returned items, quantities, condition/reason where available, and refund relevance.

### Payment

Purpose:
Expose payment/refund meaning without turning the operational page into Finance.

Orders may include:

- Payment status
- Refund completed, if relevant
- Finance hold only when it changes what the seller can do

Returns may include:

- Refund status
- Refund completed
- No action required when refund is terminal

Detailed deductions, settlement review, payment preparation, transaction evidence, and accounting explanations belong in Finance or a drill-down.

### Timeline

Purpose:
Explain what happened over time.

Timeline events should be meaningful and seller-facing. They should not show every internal transition.

Good timeline events:

- Order received
- Shipment prepared
- Vendor rejected selected items
- Refund completed
- Return requested
- Return received
- Return closed

Poor timeline events for first-level vendor UI:

- Raw internal IDs
- Webhook received
- Reconciliation job completed
- Idempotency key stored
- Finance ledger row created

### Evidence

Purpose:
Provide audit detail on demand.

Evidence should be collapsed or secondary by default. It may contain technical references only when the user has explicitly opened a detail/evidence area and the surface is safe for that role.

## Design Principles

### Orders and Returns Are Operational Work Queues

They are for doing work, not reading summaries. The seller should always be able to keep the table visible, select another item, and continue.

### Speed

The workspace should make common work fast:

- Pick workflow.
- Scan table.
- Open item.
- Take action.
- Move to next item.

### Familiarity

The workflow should feel familiar to marketplace sellers. It should resemble the operational concepts used by large seller portals: state tabs, filters, dense lists, and contextual detail panels.

### Workflow Continuity

Selecting a record should not throw the seller away from the list. The detail panel protects continuity.

### Minimal Page Navigation

Full-page navigation should be reserved for deep detail, evidence, or workflows that cannot fit safely in the panel. Everyday review should happen inside the workspace.

### Keeping the Table Visible

The table is the seller's operational map. It should stay visible while details are inspected on desktop.

### Avoiding Unnecessary Page Changes

Actions should refresh or update the selected record without unexpectedly changing workflow tabs or losing filters.

## Marketplace References

This blueprint borrows operational concepts from marketplace seller workflows such as Trendyol and Amazon Seller:

- State-first work queues
- Advanced filtering for operational lookup
- Quick refinements for repeated scanning
- Dense comparison tables
- Contextual detail without losing list position
- Clear next action per record

It does not recommend copying visual design, colors, typography, or brand expression from those products.

## Things That Must Never Change

The following are architectural commitments for Orders and Returns:

- Persistent table as the main scanning surface.
- Persistent detail panel for contextual review.
- Workflow-first thinking.
- Workflow tabs as primary workspace state.
- Advanced filters for lookup and investigation.
- Search for known-item lookup.
- Quick filters only as refinements.
- Seller-facing terminology.
- Clear next action.
- Timeline/evidence available on demand.
- Marketplace operator familiarity.
- No dashboard-style redesign for operational workspaces.
- No card-only replacement for operational tables.
- No removal of right detail panel on desktop.
- No internal IDs as primary labels.
- No backend state invented solely for UI labels.

## Implementation Roadmap

This roadmap describes phases only. It is not an implementation.

### OP-1: Workflow Tabs

Goal:
Make workflow tabs the primary workspace state on Orders and Returns.

Expected scope:

- Define tab labels from existing state evidence.
- Map current workflow query parameters and filters into tab behavior.
- Keep existing routes stable.
- Preserve existing table and right panel.

Backend required:
No, unless count accuracy across pagination requires backend support later.

### OP-2: Advanced Filters

Goal:
Separate lookup/investigation filters from workflow state.

Expected scope:

- Group search, status, shipment/refund, carrier, date, and vendor filters in a clear advanced filter area.
- Remove duplicated workflow concepts from advanced filters where possible.
- Preserve current search and filter behavior.

Backend required:
No for current filters. Unknown for new date/range filters if not already available.

### OP-3: Quick Filters

Goal:
Make quick filters lightweight refinements of the selected workflow.

Expected scope:

- Keep only filters that refine the active tab.
- Remove quick chips that duplicate workflow tabs.
- Use seller-friendly labels.

Backend required:
No for existing in-memory refinements. Possible later if server-side pagination requires count/filter support.

### OP-4: Operational Table

Goal:
Align Orders and Returns tables around canonical operational columns.

Expected scope:

- Add or clarify Next Action column.
- Remove duplicate date/status columns where they create noise.
- Hide internal or diagnostic labels from first-level vendor UI.
- Preserve dense table scanning.

Backend required:
No if current DTOs already include status, action, customer, order, return, payment, shipment, and item data. Unknown for any missing next-action projection if frontend cannot safely derive it from existing canonical helpers.

### OP-5: Right Detail Panel

Goal:
Align the right detail panel hierarchy across Orders and Returns.

Expected scope:

- Summary first.
- Next Action second.
- Operational details after action.
- Items, payment, timeline, and evidence in that order.
- Keep evidence secondary or collapsed.

Backend required:
No for layout and copy. Unknown if missing timeline or ownership data is required for a future richer Returns panel.

### OP-6: Shared Operational Components

Goal:
Reduce drift between Orders and Returns.

Expected scope:

- Shared workflow tabs.
- Shared advanced filter structure.
- Shared quick filter row.
- Shared operational table conventions.
- Shared right panel sections.
- Shared status and next-action presentation patterns.

Backend required:
No.

### OP-7: Consistency Tests

Goal:
Prevent Orders and Returns from drifting apart again.

Expected scope:

- Tests for workflow tab presence and behavior.
- Tests that quick filters do not replace workflow tabs.
- Tests that table columns include operational status and next action.
- Tests that right panel includes Summary, Next Action, Operational Details, Items, Payment, Timeline, and Evidence where applicable.

Backend required:
No.

## Unknowns

- Exact mobile detail-panel behavior requires device-level review.
- Whether server-side pagination will require backend workflow-tab counts is unknown.
- Whether all future Returns ownership/timeline fields are available in current DTOs is unknown.
- Whether Orders and Returns should share one concrete React component immediately or converge through smaller shared primitives first is an implementation decision for a later phase.
