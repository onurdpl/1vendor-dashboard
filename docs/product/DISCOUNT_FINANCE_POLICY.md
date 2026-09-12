# Discount Finance Policy & Discovery

## Status

Document status: Discovery / Product Decision Record

Implementation status: NOT IMPLEMENTED

Customer discounts/coupons currently active: NO

Finance integration status: NOT IMPLEMENTED

This document records:

- current production behavior
- closed product/accounting decisions
- Shopify discount semantics already clarified
- finance architecture implications
- unresolved business rules
- implementation blockers
- explicit out-of-scope areas

No discount behavior described here must be treated as active production behavior until a separate implementation is explicitly approved.

## 1. Current Production State

Sporgym currently does not define customer-facing:

- discount coupons
- marketplace coupons
- seller discount campaigns
- automatic discount campaigns

The existing finance system therefore currently calculates vendor economics without allocation-level discount deductions.

Current allocation finance gross is based on allocation merchandise values and does not subtract a vendor-funded discount.

The purpose of this document is to preserve future discount-finance decisions so the subject does not need to be rediscovered later.

## 2. Current Finance Basis

The current implemented chain is:

```text
Shopify line price
× allocated quantity
→ VendorAllocationLineItem.lineAmount
→ allocation merchandise amount
→ FinanceLedgerEntry.amount
→ commission
→ commission VAT
→ shipping deduction
→ refund impact
→ estimated vendor payable
→ settlement
→ payout
```

- Current finance gross does not include allocation discount.
- Current Shopify discount information is not used to reduce vendor payable.
- Frontend must not invent a discounted finance amount.

## 3. Closed Business Rule — Seller-Specific Discount

**APPROVED future business rule**

Seller-specific discount:

- vendor-funded
- reduces vendor financial gross/payable basis

Example:

```text
VAT-inclusive product value: 2,000 TL
Vendor-funded discount:       200 TL
Commission basis:            1,800 TL
```

## 4. Closed Business Rule — Sporgym Coupon

**APPROVED future business rule**

A coupon defined by Sporgym is also:

- vendor-funded
- reduces the affected vendor's financial gross/payable basis

Example:

```text
VAT-inclusive product value: 2,000 TL
Sporgym coupon:               200 TL
Commission basis:            1,800 TL
```

Marketplace-funded discounts are NOT currently supported.

If marketplace-funded discounts are introduced later, that requires a separate product/accounting decision.

## 5. Closed Business Rule — Commission Basis

**APPROVED**

Commission basis is VAT-inclusive merchandise value AFTER vendor-funded discount.

Fixed-discount example:

```text
VAT-inclusive product price: 2,000 TL
Discount:                     200 TL
Commission basis:            1,800 TL
```

Percentage-discount example:

```text
VAT-inclusive product price: 2,000 TL
Discount:                         10%
Discount amount:                 200 TL
Commission basis:            1,800 TL
```

- There is no requirement to convert this to VAT-exclusive merchandise value.
- Product VAT and commission VAT are separate concepts.
- Commission VAT remains calculated separately on Sporgym commission.

## 6. Closed Business Rule — Currency

**APPROVED**

Sporgym finance is TRY-only.

Do not design:

- FX
- exchange rates
- foreign-currency settlement
- buy/sell/mid rate logic
- currency conversion

Any future discount evidence entering finance must be compatible with the existing TRY-only finance policy.

## 7. Closed Business Rule — Historical Scope

**APPROVED**

Discount-finance rules will apply to NEW ORDERS ONLY.

No historical rollout is required.

Do not:

- backfill old orders
- recalculate historical ledgers
- rewrite settlements
- rewrite payouts
- reconstruct historical discount allocations

Historical finance evidence remains unchanged.

## 8. Closed Business Rule — Order Edit

**APPROVED**

Order-edit discount reconciliation is OUT OF SCOPE.

Current product workflow does not require order-edit discount finance behavior.

Do not design or implement late order-edit correction behavior unless it becomes a separate product requirement in the future.

## 9. Shopify Discount Data — Known Semantics

Relevant concepts include:

- order-level discount totals
- discount applications
- line-level discount allocations
- allocated discount amounts
- discounted line totals

Potential future line-level authority:

`LineItem.discountAllocations[].allocatedAmountSet`

Known meaning:

- represents discount money allocated to a specific Shopify line
- associated discount application describes source/type
- discount application itself is not the final monetary amount allocated to the line

Current Sporgym system does NOT:

- query this as finance authority
- persist line-level discount allocations
- persist discount application identity
- persist funding ownership
- map discount allocation to vendor finance
- preserve historical discount provenance

Therefore Shopify line-level allocation remains a candidate future authority, not an implemented source of truth.

## 10. Shopify Current Quantity

`LineItem.currentQuantity` represents active quantity excluding refunded and removed units.

Do not infer from this that Shopify provides one canonical current discounted merchandise total for a vendor allocation.

## 11. Shopify `discountedTotalSet` Limitation

`discountedTotalSet` must NOT automatically be treated as Sporgym's current active vendor-finance gross.

Reasons already established:

- it can include refunded/removed quantities
- it has limitations around different discount categories
- it is not an approved Sporgym settlement authority

Therefore, `discountedTotalSet` is NOT approved as vendor-finance gross authority.

## 12. Shopify Tax Limitation

Shopify line tax values must not automatically be treated as a current vendor-allocation product-tax total after refunds/removals.

There is currently no approved Sporgym allocation-level product-tax-total calculation.

This does NOT change the approved rule that commission basis is VAT-inclusive discounted merchandise value.

## 13. Shopify Checkout Shipping

Shopify does not provide native vendor allocation of checkout shipping.

Current Sporgym vendor finance does not attribute customer-paid checkout shipping to vendors.

Customer checkout shipping must therefore remain separate from vendor finance unless a future product rule explicitly changes this.

## 14. Multi-Vendor Coupon Problem

**Status: UNRESOLVED**

Example:

```text
Vendor A merchandise: 1,000 TL
Vendor B merchandise: 3,000 TL
Order merchandise:    4,000 TL
Coupon:                  400 TL
```

Open question: How much discount belongs financially to Vendor A and Vendor B?

Candidate future approach:

Use Shopify line-level discount allocations and sum the discount amounts attached to the Shopify lines owned by each vendor.

Example if Shopify allocates:

```text
Vendor A lines: 100 TL discount
Vendor B lines: 300 TL discount

Vendor A discounted gross:
1,000 - 100 = 900 TL

Vendor B discounted gross:
3,000 - 300 = 2,700 TL
```

This approach is NOT yet approved for implementation.

## 15. Finance Impact of Future Discount

If a correct discounted finance gross is created BEFORE finance-ledger creation, current architecture indicates that these downstream values naturally change:

- finance gross
- commission
- commission VAT
- estimated payable
- settlement gross
- settlement commission
- settlement commission VAT
- commission invoice values

Shipping deduction is independent of merchandise discount.

Payout does not need its own discount calculation if approved settlement values are already correct.

This does NOT mean implementation is ready because refund, provenance, missing evidence, split, reassignment, and rounding remain unresolved.

## 16. Refund Interaction

**HIGH PRIORITY / UNRESOLVED**

Current refund finance starts from Shopify refund evidence and allocation ownership, but current finance does not preserve allocation discount evidence.

### Full refund

```text
Original VAT-inclusive product value: 2,000 TL
Vendor-funded discount:                200 TL
Discounted vendor gross:             1,800 TL
```

Open question: What exact vendor-finance amount is reversed on full refund?

Status: UNRESOLVED

### Partial refund

Open question: How much of the original discount belongs to the refunded quantity/line portion?

Status: UNRESOLVED

### Multi-vendor coupon refund

If one coupon affected multiple vendors and only one vendor's product is refunded, the system must know the historical discount share belonging to that vendor and line.

Current system does not persist that evidence.

Status: UNRESOLVED

### Post-settlement refund

Current approved settlement evidence is immutable.

Discount-aware refund-adjustment behavior remains unresolved.

Status: UNRESOLVED

### Post-payout refund

Current finance creates vendor debt instead of rewriting paid payout.

Discount-aware vendor-debt basis remains unresolved.

Status: UNRESOLVED

## 17. Discount Evidence / Provenance

Current schema is not sufficient to fully audit future vendor-funded discounts.

Potentially missing historical evidence includes:

- original merchandise value
- allocation discount amount
- discounted merchandise value
- line-level discount allocations
- discount application identity
- discount origin
- funding owner
- discount snapshot/version
- discount consumed/restored during refunds
- rounding remainder ownership

Changing only `FinanceLedgerEntry.amount` is not sufficient for complete historical auditability.

Exact persistence model is NOT yet approved.

## 18. Funding Ownership

Closed future direction:

```text
Seller-specific discount
→ vendor-funded

Sporgym coupon
→ vendor-funded

Marketplace-funded discount
→ NOT CURRENTLY SUPPORTED
```

Even if both current future discount types have the same financial effect, preserving origin may still be useful for:

- audit
- customer support
- finance explanation
- reconciliation
- future policy changes

Whether origin must be immutable finance evidence remains unresolved.

## 19. Shipping Discount Separation

**UNRESOLVED**

Future ingestion must prevent Shopify shipping discounts from being treated as merchandise discounts.

It must distinguish:

- merchandise-targeted discount
- shipping-targeted discount

Current system does not persist enough discount application evidence for this distinction.

No fallback must be invented.

## 20. Rounding Residual

**UNRESOLVED**

Existing finance uses two-decimal money and minor-unit rounding.

Example:

```text
Coupon total: 100.00 TL

Vendor allocated discounts:
33.33
33.33
33.33

Total:
99.99 TL

Remaining:
0.01 TL
```

Open question: Which allocation owns the residual kuruş?

DISCOUNT ROUNDING RESIDUAL POLICY: UNKNOWN

No rule has been approved.

## 21. Missing or Incomplete Shopify Discount Evidence

**HIGH PRIORITY / UNRESOLVED**

Future implementation must define what happens if canonical discount evidence is:

- missing
- incomplete
- partially paginated
- inconsistent
- unmappable to a `VendorAllocation` line

Possible responses such as:

- treat discount as zero
- hold finance
- block settlement
- require admin review

are NOT approved.

No implementation may invent fallback behavior.

## 22. Allocation Split

**UNRESOLVED**

Current split logic divides allocation lines and creates replacement finance ledgers.

Current split logic does not preserve discount provenance.

Future unresolved questions include:

- Does each line carry an immutable discount share?
- What happens on partial-quantity split?
- How is rounding residual handled?
- Does child allocation inherit discount application identity?

No rule is approved.

## 23. Vendor Reassignment

**UNRESOLVED**

Current reassignment can transfer economic ownership.

A numeric discounted gross might be transferable, but current schema does not preserve discount provenance.

Future unresolved questions:

- Does original discount evidence remain attached to the allocation?
- Does vendor reassignment change discount ownership?
- Does target vendor inherit original discounted gross unchanged?

No rule is approved.

## 24. Current Schema Assessment

**CURRENT SCHEMA SUFFICIENT FOR FULLY AUDITABLE DISCOUNT FINANCE: NO**

Current schema can store a final finance gross but cannot fully preserve why that amount exists.

Potential missing concepts:

- original merchandise basis
- allocation discount
- discounted merchandise basis
- line discount allocation
- campaign/application identity
- funding origin
- refund discount consumption
- rounding residual ownership

Do not propose schema changes yet.

## 25. Values That Must Stay Separate

### Original merchandise value

Value before vendor-funded discount.

### Allocation discount

Vendor-funded discount attributable to that allocation.

### Discounted merchandise / finance gross

```text
original merchandise value
- vendor-funded allocation discount
```

This is the intended future commission basis.

### Commission

Calculated from VAT-inclusive discounted finance gross.

### Commission VAT

Separate VAT on Sporgym commission.

### Shipping deduction

Independent vendor shipping finance deduction.

### Refund impact

Separate refund-derived finance reversal.

### Estimated payable

Backend finance result.

### Approved payable

Immutable settlement-approved amount.

### Paid amount

Local payout/payment evidence.

Do not merge these into one ambiguous "amount".

## 26. Current Admin Orders Implication

The current Admin Orders Shopify Order Snapshot must NOT be treated as an allocation financial summary.

Current full-order fields such as:

- order tax
- order shipping
- order discount

are not vendor-allocation finance authority.

A future allocation finance summary may potentially contain:

- original product value
- allocation discount
- discounted finance gross
- commission
- commission VAT
- shipping deduction
- refund impact
- estimated payable
- settlement status
- approved payable
- payout status
- paid amount

This must not be implemented until the unresolved rules are closed and an allocation-keyed authoritative backend finance projection exists.

## 27. Finance Safety Invariants

1. Frontend must never calculate authoritative vendor payable.
2. One vendor allocation must never consume another vendor allocation's discount.
3. Full-order Shopify discount must never be assigned directly to one vendor without line-level evidence or an explicitly approved allocation rule.
4. Discount attribution must remain vendor/allocation scoped.
5. Commission and commission VAT must use the same immutable finance-gross basis.
6. Approved settlement monetary evidence remains immutable.
7. Paid payout evidence remains immutable.
8. Refund must not double-reverse commission or commission VAT.
9. Return lifecycle remains separate from monetary refund evidence.
10. Shipping deduction remains separately evidenced.
11. Missing discount evidence must never be replaced by guessed monetary values.
12. Existing historical finance records remain unchanged.
13. Finance remains TRY-only.
14. Order-edit support must not be introduced implicitly.
15. Payout must consume approved settlement truth rather than recalculating discount.

## 28. Closed Decisions

| Question | Decision |
|---|---|
| Are discounts currently active? | No |
| Seller-specific discount funding | Vendor-funded |
| Sporgym coupon funding | Vendor-funded |
| Marketplace-funded discount | Not currently supported |
| Does vendor-funded discount reduce vendor gross? | Yes |
| Commission basis | VAT-inclusive discounted merchandise value |
| 2,000 TL VAT-inclusive product - 200 TL discount | 1,800 TL commission basis |
| 2,000 TL VAT-inclusive product - 10% discount | 1,800 TL commission basis |
| Finance currency | TRY only |
| FX | Not required / out of scope |
| Order-edit discount support | Out of scope |
| Historical backfill | Not required |
| Rollout | New orders only |
| Customer checkout shipping allocation | Not part of current vendor finance |
| Payment-processing fee | No current finance authority and not part of this work |
| Shipping deduction affected by merchandise discount? | No |
| Does payout recalculate discount? | No; payout consumes approved settlement truth |

## 29. Open Decisions

### Priority 1 — Multi-vendor discount authority

Question: Should Shopify line-level `discountAllocations[].allocatedAmountSet` be the canonical discount attribution source for `VendorAllocation` finance?

Status: UNRESOLVED

### Priority 2 — Refund interaction

Must define behavior for:

- full refund
- partial refund
- partial quantity refund
- multi-vendor coupon + one vendor refund
- post-settlement refund
- post-payout refund/vendor debt

Status: UNRESOLVED

### Priority 3 — Missing discount evidence

Must define finance behavior if canonical Shopify discount evidence is incomplete or unavailable.

Status: UNRESOLVED

### Priority 4 — Rounding residual

Must define residual-kuruş ownership.

Status: UNRESOLVED

### Priority 5 — Discount evidence persistence

Must define which evidence becomes immutable:

- application identity
- origin
- funding owner
- line allocation
- original merchandise value
- allocation discount
- discounted gross
- snapshot/version

Status: UNRESOLVED

### Priority 6 — Shipping discount separation

Must define the exact rule that ensures shipping discounts never reduce merchandise finance gross.

Status: UNRESOLVED

### Priority 7 — Split handling

Must define discount behavior during allocation split.

Status: UNRESOLVED

### Priority 8 — Vendor reassignment

Must define whether and how original discount evidence follows economic ownership after reassignment.

Status: UNRESOLVED

## 30. Explicitly Out of Scope

- FX
- foreign-currency settlement
- historical backfill
- order-edit reconciliation
- marketplace-funded discounts
- payment-processing fee calculation
- broad payout redesign
- UI implementation
- schema implementation

## 31. Implementation Gate

Discount/coupon finance implementation MUST NOT start until at minimum these are resolved:

1. Multi-vendor discount authority
2. Refund / partial-refund interaction
3. Missing/incomplete discount evidence behavior
4. Rounding residual rule
5. Discount evidence persistence requirements
6. Shipping-discount exclusion rule

After these are resolved:

1. Run final finance architecture audit.
2. Define minimum persistence model.
3. Define allocation-keyed backend finance projection.
4. Define focused tests.
5. Implement backend finance authority.
6. Only then expose discount-adjusted finance in Admin Orders UI.

## 32. Next Review Point

No further discount implementation work is required while Sporgym does not offer customer discounts or coupons.

When discount/coupon functionality becomes a real product requirement, resume from Section 29 — Open Decisions.

Do not rediscover closed decisions from scratch.
