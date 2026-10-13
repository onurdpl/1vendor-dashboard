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

## Phase 4B Scheduled Settlement Workspace

Operators can review scheduled settlement candidates from:

`/admin/finance/settlement-schedules`

Workflow:

Dry Run
↓
Review due vendors, blockers, existing drafts, and pending refund adjustments
↓
Create Drafts
↓
Open Settlement Workspace
↓
Approve
↓
Invoice

The workspace is an operator UI on top of the existing dry-run and draft-creation endpoints. Dry run is read-only. Draft creation still creates draft settlement approvals only; it does not auto approve, create Logo invoices, create payouts, or call payment providers.

## Phase 4C Scheduled Auto Draft Job

The scheduled auto-draft job runs the same dry-run and draft-creation logic used by the Scheduled Settlement Workspace.

Manual trigger endpoint:

`POST /admin/finance/settlement-schedules/run-auto-draft-job`

Status endpoint:

`GET /admin/finance/settlement-schedules/auto-draft-job-status`

Environment gates:

- `SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=false` by default
- `SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN=true` by default

When disabled, the job returns a blocked response and creates no drafts.

When dry-run mode is enabled, the job returns the vendors it would process and creates no drafts.

Only when all of the following are true can the job create draft settlements:

- `SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=true`
- `SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN=false`
- request body contains `confirmScheduledSettlementAutoDraftJob=true`

The job is idempotent by run date through `SettlementScheduleJobRun`. Re-running the same run date does not create duplicate drafts.

## Phase 4C.1 Scheduled Cycle Identity

Scheduled settlement drafts also carry a per-vendor cycle identity:

`scheduled-settlement:{vendorId}:{YYYY-MM-DD}`

Only scheduled-created approvals receive this identity. Manual settlement approvals can keep the scheduled fields empty.

Rules:

- one non-cancelled scheduled settlement approval is allowed per vendor per run date
- an existing scheduled `DRAFT` approval returns `DRAFT_EXISTS`
- an existing scheduled `APPROVED` approval returns `SETTLEMENT_EXISTS`
- `CANCELLED` scheduled approvals retain the cycle key; ordinary creation is blocked and a controlled Admin replacement is separate
- late-arriving eligible rows after a scheduled cycle was approved are not merged into the old settlement
- late-arriving eligible rows must wait for the next scheduled cycle

The Scheduled Settlements workspace uses the backend dry-run state for these decisions. It should not infer cycle state from recent drafts alone.

The job creates draft settlement approvals only. It does not approve settlements, create Logo invoices, create commission invoice records, create payment records, or execute payouts.

Deployment scheduler note:

Render or another scheduler can call the manual trigger endpoint once per day after the environment gates are intentionally enabled. Until then, operators can run the trigger from the Scheduled Settlement Workspace.

## Automatic read-only schedule (opt-in)

The backend also has a passive in-process scheduler. It is **disabled by default**. It installs a timer only when `SETTLEMENT_AUTO_DRAFT_SCHEDULER_ENABLED=true` **and** `SETTLEMENT_AUTO_DRAFT_SCHEDULER_UTC_TIME` is explicitly set to a valid `HH:mm` UTC time. Missing or invalid time fails startup rather than choosing a production run time. Render is not enabled by this code change.

At that UTC time each day, it evaluates the **previous completed UTC day** as `runDate` (and its UTC `periodEnd`). It does not run immediately on startup or catch up missed days. This is an advisory preview, not scheduled DRAFT creation. The scheduler forces `SETTLEMENT_AUTO_DRAFT_JOB_ENABLED=true`, `SETTLEMENT_AUTO_DRAFT_JOB_DRY_RUN=true`, and `confirmScheduledSettlementAutoDraftJob=false` for its own invocation, regardless of the manual job's write-related environment flags. The existing dry-run eligibility and blocker classification are reused; no `SettlementScheduleJobRun`, settlement DRAFT, or new financial authority is written.

Each completion is logged with the evaluated run date, vendor/due/ready counts, blocked vendor IDs and blocker reasons, and outcome. No customer details are logged. An in-process guard skips overlapping executions; shutdown clears the timer. This is not a distributed lease or durable missed-day recovery mechanism. The manual Admin job and its separate write gates are unchanged.

## Examples

21 days delay with weekly Wednesday settlement:

- order/delivery becomes eligible after 21 days
- the next Wednesday run can create a draft if payable rows exist

14 days delay with biweekly Wednesday settlement:

- order/delivery becomes eligible after 14 days
- every second configured Wednesday run can create a draft if payable rows exist

Biweekly scheduling currently uses deterministic ISO week parity for the every-second-week rule.
