# Vendor Finance Terminology Map

## Design Philosophy

Vendor Finance is a Payment Workspace.

Vendor is NOT an accountant.

Vendor should immediately understand:

- What happened?
- How much money is affected?
- When will I receive payment?
- Do I need to do anything?

Vendor must NEVER need to understand:

- Settlement
- Ledger
- Allocation
- Finance Event
- Offset
- Approval IDs
- Reference IDs
- Commission Invoice
- Accounting workflow

## Forbidden Vendor Terminology

These words MUST NEVER appear in vendor UI.

- Settlement
- Settlement Review
- Settlement Adjustment
- Settlement Draft
- Ledger
- Finance Event
- Offset
- Offset Review
- Payout Accounting
- Allocation
- Approval ID
- Reference ID
- Commission Invoice
- Accounting Review
- Internal Reference

## Vendor Transaction Types

| Backend | Vendor |
| --- | --- |
| Sale | Sipariş Geliri |
| Refund | İade |
| Adjustment | Bakiye Düzeltmesi |
| Shipping | Kargo |
| Payout | Ödeme |

## Vendor Status Vocabulary

This vocabulary is mandatory.

Never invent alternatives.

| Backend meaning | Vendor |
| --- | --- |
| Waiting for payment | Ödeme Bekliyor |
| Under review | İncelemede |
| Ready for payment | Hazır |
| On hold | Askıda |
| Waiting | Beklemede |
| Paid | Ödendi |
| Estimated | Hesaplanıyor |

Do NOT use:

- Preparing
- Processing
- Blocked
- Ready
- Review
- Settlement Ready
- Settlement Review

## Vendor Card Titles

| English reference | Vendor |
| --- | --- |
| Transaction Summary | İşlem Özeti |
| Payment Impact | Ödeme Etkisi |
| Next Action | Sonraki Adım |
| Related Records | İlgili Kayıtlar |
| Activity | Hareket Geçmişi |
| Support | Destek |
| Why is this payment waiting? | Bu ödeme neden bekliyor? |

## Vendor Actions

Only these action labels may be used.

- İşlem Gerekmiyor
- İnceleme Bekleniyor
- İlgili Siparişi İncele
- Destek ile İletişime Geç

Never invent additional action wording.

## Copy Rules

Rule 1

Vendor cards should contain ONE clear sentence maximum.

Rule 2

Do not explain obvious statuses.

Example:

İncelemede

Do NOT also write:

İnceleme devam ediyor.

Rule 3

Badges must communicate the state.

Body text must communicate only additional information.

Rule 4

Avoid technical explanations.

Explain business outcome instead.

## Golden Rule

Vendor screens explain the seller's money.

Vendor screens NEVER explain how the system works.

## Implementation Rules

Future implementations MUST reference this document.

Any new vendor-facing finance terminology that is not listed here must NOT be introduced.

If a new term is required, update this document first.
