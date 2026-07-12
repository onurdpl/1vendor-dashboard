# Sporgym Product Specification

This document is the product source of truth for Sporgym's vendor-facing experience.

It defines how the product should feel, what it should prioritize, how it should speak, and how future vendor-facing UI decisions should be judged. It is not a coding guide, React guide, CSS guide, or backend implementation guide.

If the current UI conflicts with this specification, this specification wins.

## 1. Product Manifesto

Sporgym exists to help marketplace sellers run daily operations with confidence.

Vendors do not open Sporgym because they want software. They open it because they need to answer urgent business questions:

- What needs to be shipped?
- Which order needs attention?
- What money is available?
- What is waiting, blocked, or deducted?
- What should I do next?

The product serves marketplace vendors who sell through Sporgym and need a calm operational home for orders, returns, products, finance, and support. It also supports Sporgym operations teams, but the vendor-facing product must never feel like an internal admin tool exposed to sellers.

Sporgym reduces operational stress. It turns complex marketplace workflows into understandable next steps. It hides internal machinery until the user asks for detail. It makes uncertainty visible, but not overwhelming.

The product must build confidence. Every page should reduce uncertainty within seconds. Every workflow should answer what happened, what it means, and what the user can do now.

We simplify complexity. Marketplace work contains fulfillment rules, vendor allocations, payment timing, refunds, returns, product availability, support requests, settlement reviews, and operational holds. The vendor should not need to understand internal state machines to operate correctly.

We expose information only when needed. The first screen should answer the primary question. Deeper screens can show evidence, calculations, and history.

We design for daily use. Sporgym is not a once-a-month reporting tool. It should feel fast, predictable, and low-friction when used repeatedly throughout the day.

## 2. Product Philosophy

Sporgym should feel calm, premium, trustworthy, modern, operational, and fast.

It should feel closer to a high-quality seller portal or financial operations workspace than to an ERP. The user should feel that the product is quietly taking care of complexity in the background.

The product is not:

- ERP software
- Accounting software
- Legacy enterprise software
- A generic admin panel
- A database browser

Sporgym should not celebrate complexity. It should make complex marketplace operations feel controlled.

The visual and product experience should support trust:

- Clear hierarchy
- Plain language
- Stable navigation
- Predictable actions
- Honest loading and empty states
- Evidence available on demand
- No noisy dashboards

The product should be modern without being decorative. The interface should feel intentional, restrained, and useful. Decoration must never compete with operational clarity.

## 3. Product Principles

### 5-second understanding rule

Within five seconds, a vendor should understand the page's primary meaning. On Finance, they should know how much money is available and when payment is expected. On Orders, they should know what needs shipment or review. On Returns, they should know what requires action.

### Progressive disclosure

Show the answer first, then the reason, then the evidence. Do not expose allocation IDs, ledger details, internal statuses, reconciliation diagnostics, or accounting mechanics on first contact unless they are the user's immediate task.

### One primary question per page

Each page must answer one main question:

- Dashboard: What needs my attention today?
- Orders: Which orders need action?
- Finance: How much money do I have, and when will I be paid?
- Returns: Which returns need review or action?
- Support: Which conversations need a response?
- Products: Which products need availability or catalog attention?

### One hero KPI

A page may have supporting metrics, but only one metric should dominate. Multiple equal-weight hero cards create doubt about what matters.

### One primary action

For any state, the primary next action must be obvious. Secondary actions can exist, but they should not compete visually.

### No duplicated actions

The same action should not appear in multiple nearby places with different labels. Duplicate actions make the product feel unreliable.

### No duplicated information

The same status or number should not be repeated in multiple panels unless each instance has a different purpose. Repetition creates noise and makes users wonder which one is authoritative.

### Action before explanation

When action is required, state the action first. Explain the reason after. Operators scan for what they need to do.

### Details belong in drill-down

Tables, drawers, and detail pages can show calculations, event history, IDs, allocation context, and audit evidence. The overview should not.

### Trust before density

More information does not always create trust. Clear hierarchy, accurate labels, and honest state explanations create trust.

### Information hierarchy before decoration

Layout, spacing, typography, and grouping must communicate priority before any visual flourish is considered.

### Consistency over creativity

A status should mean the same thing everywhere. A vendor should not see one story in Orders and a different story in Finance.

## 4. Information Architecture

Vendor navigation should be stable and task-oriented:

### Dashboard

The daily command center. It answers what changed, what needs attention, and what should be done next. It should not become a dense analytics page.

### Orders

The fulfillment workspace. It answers which orders are new, ready to ship, blocked, refunded, or completed. It should make shipment work efficient and blocked states understandable.

### Products

The catalog and availability workspace. It answers which products are sellable, blocked, unavailable, or need attention. Product availability actions should be safe and auditable.

### Returns

The return operations workspace. It answers which returns are requested, received, refunded, closed, or need vendor/admin attention.

### Finance

The seller money workspace. It answers how much money is available, what is pending, what is held, when payment is expected, and what changed recently. Accounting details belong behind Transactions, Reports, or drawers.

### Support

The conversation and issue workspace. It answers which tickets need response, which are waiting, and which are resolved.

### Settings

The configuration workspace. It contains vendor profile, warehouse, payout, contact, notification, and integration settings. It should be calm and explicit about what can and cannot be changed by the vendor.

## 5. User Journeys

### Morning login

The vendor opens Sporgym to understand the day. The product should show the highest-priority operational items first: new orders, shipment work, returns, support messages, and finance changes. The vendor should not need to inspect every module to know whether action is required.

### New order

The vendor needs to see the order, confirm whether the items can be fulfilled, and prepare shipment. The product should clearly separate normal fulfillment from blocked or exceptional states.

### Preparing shipment

The vendor needs a short path from order review to shipment action. Shipment actions should not appear when fulfillment is blocked, refunded, or not required.

### Checking payments

The vendor wants to know available balance, next expected payment, pending balance, held balance, and recent changes. Detailed deductions and settlement evidence should be accessible, but not prominent.

### Handling refunds

The vendor needs to understand that a refund happened, which order or item it affected, and whether any action remains. The product should distinguish operational resolution from settlement or accounting review.

### Responding to support

The vendor needs to know which conversations require response and what context is connected: order, return, product, or finance issue. The product should avoid making support feel separate from operations.

### End-of-day review

The vendor checks whether all shipments, returns, and support items are handled. Finance should summarize what changed during the day without requiring accounting interpretation.

## 6. Terminology

Use seller-facing terminology. Do not expose backend terminology unless the user is in a technical audit or admin-only diagnostic context.

| Backend / internal concept | Seller-facing term |
| --- | --- |
| Finance Ledger | Transactions |
| Finance Event | Activity |
| Settlement Approval | Settlement |
| Settlement Review | Settlement Review |
| Refund Offset | Refund Adjustment |
| Payout Batch | Payment Preparation |
| Vendor Debt | Balance Adjustment |
| VendorAllocation | Order Assignment |
| VendorAllocationLineItem | Assigned Item |
| VENDOR_BLOCKED | Vendor Blocked |
| OperationalSignal | Needs Attention |
| Canonical Reconciliation | Sync Check |
| Outbound Attempt | Delivery Attempt |
| Product Panel Variant Disable | Product Availability Update |
| Fulfillment Order | Shopify Fulfillment State |
| Finance Integrity Alert | Finance Review Needed |
| Reassignment Required | Admin Resolution Required |

Rules:

- Say "payment" when speaking to vendors about money movement.
- Say "transactions" when showing money activity.
- Say "activity" when showing event history.
- Say "review" when human verification is required.
- Avoid "ledger", "batch", "allocation", "webhook", "idempotency", "canonical", and "reconciliation" in vendor-facing first-level UI.

## 7. Page Blueprints

These are conceptual ASCII wireframes. They define hierarchy, not visual design.

### Dashboard

```text
Dashboard

[Primary focus: Today needs attention]

Needs attention
--------------------------------------------------
Orders to ship | Returns to review | Support replies

Recent changes
--------------------------------------------------
Today      Order became ready to ship
Today      Refund completed
Yesterday  Payment estimate updated

Quick access
--------------------------------------------------
Orders | Finance | Returns | Support | Products
```

### Orders

```text
Orders

[Primary focus: Orders needing action]

Filters: Status | Date | Search

Order list
--------------------------------------------------
Order | Customer | Operational Status | Next Action

Side rail
--------------------------------------------------
Operational Status
Payment Status
Next Action
Important details
```

### Finance

```text
Finance

[Hero: Available Balance]

Available Balance
--------------------------------------------------
TRY X

Next Payment
--------------------------------------------------
Estimated amount | Estimated date | Status

Pending Balance     Held Balance
--------------------------------------------------

Recent Changes
--------------------------------------------------
Today      Order became eligible
Today      Refund deducted
Yesterday  Payment preparation updated

Payment Progress
--------------------------------------------------
Sales -> Delivered -> Settlement -> Payment Preparation -> Paid

Quick Links
--------------------------------------------------
Transactions | Settlements | Payments | Reports | Refunds
```

### Returns

```text
Returns

[Primary focus: Returns needing action]

Return queues
--------------------------------------------------
Requested | In transit | Received | Refunded | Closed

Return list
--------------------------------------------------
Return | Order | Status | Next Action

Detail rail
--------------------------------------------------
Return state
Owner / responsibility
Refund status
Timeline
```

### Support

```text
Support

[Primary focus: Conversations needing response]

Inbox
--------------------------------------------------
Needs reply | Waiting | Resolved

Ticket list
--------------------------------------------------
Subject | Related order | Priority | Last activity

Conversation detail
--------------------------------------------------
Messages
Context
Next action
```

### Products

```text
Products

[Primary focus: Product availability]

Availability summary
--------------------------------------------------
Active | Attention needed | Disabled | Draft

Product list
--------------------------------------------------
Product | SKU | Status | Inventory / availability | Action

Detail
--------------------------------------------------
Availability state
Catalog data
Recent changes
```

### Order Detail

```text
Order Detail

Operational Status
--------------------------------------------------
Primary state | Payment state | Next action

Items
--------------------------------------------------
Assigned items | Quantity | Fulfillment state

Timeline
--------------------------------------------------
Order received
Vendor action
Shipment / refund / return events

Details
--------------------------------------------------
Customer | Address | Shopify order snapshot
```

### Finance Drawer

```text
Finance Detail

Transaction summary
--------------------------------------------------
Amount | Status | Related order

Why this amount changed
--------------------------------------------------
Plain-language explanation

Breakdown
--------------------------------------------------
Commission | VAT | Shipping | Refund adjustment | Balance adjustment

Activity
--------------------------------------------------
Created | Reviewed | Prepared | Paid
```

### Return Detail

```text
Return Detail

Return Status
--------------------------------------------------
Current state | Refund state | Next action

Items
--------------------------------------------------
Returned items | Quantity | Condition / reason

Ownership
--------------------------------------------------
Responsible vendor | Transfer history if relevant

Timeline
--------------------------------------------------
Requested | Approved | Received | Refunded | Closed
```

## 8. Component Rules

### Hero KPI

Use when one number answers the page's primary question. Do not use multiple hero KPIs on the same screen.

Examples:

- Finance: Available Balance
- Dashboard: Needs Attention
- Orders: Orders requiring action

### Cards

Use cards for grouped summaries or repeated items. Do not use cards as decoration. Avoid large equal-weight card grids when the user needs priority.

### Tables

Use tables for dense comparison, history, and detail review. Tables belong in operational lists and drill-down areas. Do not make a table the first thing a vendor sees when a simpler summary answers the main question.

### Drawers

Use drawers for contextual detail without losing list position. Drawers should explain the selected item and expose next action, history, and evidence.

### Timelines

Use timelines to explain what happened over time. They are ideal for orders, returns, support history, finance activity, and reconciliation evidence. Timelines should contain meaningful events, not every internal transition.

### Charts

Use charts only when trend understanding matters. Do not use charts to decorate dashboards. If a chart does not answer a real vendor question, do not include it.

### Tabs

Use tabs to separate modes of work within the same area. Tabs should not hide the primary action. Finance may use Overview and Transactions because those represent different levels of detail.

### Filters

Use filters when users need to reduce a list. Avoid excessive filters on first screen summaries. Filters should remember the user's intent and not create dead ends.

### Buttons

Use one primary button for the most important action. Secondary actions should be visually quieter. Do not repeat the same action with different labels.

### Search

Use search for known-item lookup: order number, SKU, customer, ticket, return, transaction. Search should not replace clear navigation.

### Status badges

Use badges for concise state, not explanations. A badge should be paired with plain-language copy when the state has operational consequences.

## 9. UX Anti-Patterns

The following patterns are forbidden in vendor-facing first-level UI:

- Duplicate CTA
- Duplicate navigation
- Multiple hero metrics
- ERP-style landing pages
- Technical backend terminology
- Huge explanation cards before action
- Information without action
- Showing accounting internals first
- Too many equal-weight cards
- Action hidden behind multiple clicks
- Shipment actions shown on refunded or blocked orders
- Finance rows presented as payout-ready when they are only accounting evidence
- Internal IDs as primary labels
- Dense dashboard panels that do not answer a daily vendor question
- Statuses that conflict across pages
- Showing the same operational story differently in Orders, Finance, and Dashboard

## 10. Implementation Principles

Future implementation phases must follow these rules:

- Reuse backend first.
- Minimize new endpoints.
- Never redesign backend because of UI preference alone.
- Frontend adapts to business rules.
- Business rules do not adapt to frontend convenience.
- Ship small controlled iterations.
- Preserve operational safety over visual ambition.
- Use existing projections before creating new ones.
- Centralize operational story interpretation.
- Do not create page-specific state copy when a canonical story layer exists.
- Keep admin diagnostics out of vendor first-level surfaces.
- Prefer clarity improvements before adding features.

Implementation should make the current product more understandable without weakening finance, fulfillment, refund, return, settlement, payout, or product availability safety.

## 11. Product Roadmap

This roadmap defines product direction only. It is not an implementation plan.

### Vendor Experience

Create a calmer daily workspace across Dashboard, Orders, Finance, Returns, Products, and Support. Make every page answer the primary daily question quickly.

### Finance

Continue shaping Finance into a seller money home. Overview should stay simple. Transactions, settlements, payments, reports, and refund details should provide drill-down evidence.

### Orders

Make order states consistent across row, right rail, and detail. Blocked, refunded, transferred, returned, and fulfilled stories must never conflict.

### Dashboard

Turn Dashboard into the daily attention surface. It should summarize urgent work and recent changes, not duplicate every module.

### Returns

Make return lifecycle states easy to understand: requested, in transit, received, refunded, closed. Show ownership and next action clearly.

### Products

Create a product availability workspace that supports sellable, unavailable, disabled, and needs-attention states without exposing integration mechanics first.

### Support

Build a support workspace that connects conversations to orders, returns, products, and finance context. The vendor should always know why a ticket matters.

### Operations And Diagnostics

DIAG-ORDER-1 is an implemented Tier-1 Operational Tool. Admins use the read-only Order State Inspector in `/admin/diagnostics` as the first stop for one-order production incidents. It explains persisted lifecycle state and projection reasons without repairing records, replaying webhooks, calling providers, or exposing customer PII and secrets.

### Analytics

Add analytics only after daily workflows are clear. Analytics should answer business questions, not fill space.

## Final Review Standard

Before any future vendor-facing change ships, ask:

- Can the user understand the page in five seconds?
- Is there one clear primary question?
- Is there one clear primary action?
- Are internal terms hidden unless the user is in a drill-down?
- Does this page agree with the rest of the product?
- Does the design reduce uncertainty?

If the answer is no, the change is not ready.
