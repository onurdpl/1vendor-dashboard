# Settlement Scheduling

Settlement scheduling is configured from the vendor Finance Policy.

The supported scheduling model is:

- Settlement delay days
- Settlement frequency
- Weekly settlement day

Monthly settlement scheduling is not supported.

## Rules

Finance rows become eligible according to the saved settlement delay snapshot used by settlement approval preview.

Scheduled runs create draft settlement approvals only when:

- the vendor is due on the configured run date
- auto settlement draft is enabled
- existing settlement preview returns eligible rows

Phase 4A does not auto approve settlements, create Logo invoices, create payouts, or call payment providers.

## Examples

21 days delay with weekly Wednesday settlement:

- order/delivery becomes eligible after 21 days
- the next Wednesday run can create a draft if payable rows exist

14 days delay with biweekly Wednesday settlement:

- order/delivery becomes eligible after 14 days
- every second configured Wednesday run can create a draft if payable rows exist

Biweekly scheduling currently uses deterministic ISO week parity for the every-second-week rule.
