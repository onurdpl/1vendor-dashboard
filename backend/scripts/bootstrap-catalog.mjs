import { createHash } from 'node:crypto';

// Stable, semantic pg_catalog inventory. OIDs, owners, grants, and Prisma's
// bookkeeping table are deliberately excluded; integrity objects are not.
const inventorySql = `
WITH objects AS (
  SELECT 'relation' AS kind, c.relname::text AS name,
    jsonb_build_object('type', c.relkind, 'persistence', c.relpersistence,
      'options', c.reloptions, 'view', CASE WHEN c.relkind IN ('v','m') THEN pg_get_viewdef(c.oid, true) END)::text AS definition
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','S','f') AND c.relname <> '_prisma_migrations'
  UNION ALL
  SELECT 'column', c.relname::text || '.' || a.attname::text,
    jsonb_build_object('type', format_type(a.atttypid, a.atttypmod), 'notNull', a.attnotnull,
      'default', pg_get_expr(d.adbin, d.adrelid), 'identity', a.attidentity,
      'generated', a.attgenerated, 'collation', CASE WHEN a.attcollation <> t.typcollation THEN a.attcollation::regcollation::text END)::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid
  JOIN pg_type t ON t.oid = a.atttypid
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','v','m','f') AND c.relname <> '_prisma_migrations'
    AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'enum', t.typname::text || '.' || e.enumsortorder::text, to_jsonb(e.enumlabel)::text
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'constraint', c.conrelid::regclass::text || '.' || c.conname::text,
    jsonb_build_object('type', c.contype, 'definition', pg_get_constraintdef(c.oid, true), 'validated', c.convalidated)::text
  FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
  WHERE n.nspname = 'public' AND c.conrelid::regclass::text NOT IN ('_prisma_migrations', 'public._prisma_migrations')
  UNION ALL
  SELECT 'index', i.indrelid::regclass::text || '.' || c.relname::text,
    jsonb_build_object('definition', pg_get_indexdef(c.oid), 'unique', i.indisunique,
      'predicate', pg_get_expr(i.indpred, i.indrelid))::text
  FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND i.indrelid::regclass::text NOT IN ('_prisma_migrations', 'public._prisma_migrations')
  UNION ALL
  SELECT 'function', p.proname::text || '(' || pg_get_function_identity_arguments(p.oid) || ')', to_jsonb(pg_get_functiondef(p.oid))::text
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'trigger', t.tgrelid::regclass::text || '.' || t.tgname::text, to_jsonb(pg_get_triggerdef(t.oid, true))::text
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal AND c.relname <> '_prisma_migrations'
  UNION ALL
  SELECT 'sequence', c.relname, jsonb_build_object('type', format_type(s.seqtypid, NULL),
    'start', s.seqstart, 'increment', s.seqincrement, 'min', s.seqmin, 'max', s.seqmax, 'cache', s.seqcache, 'cycle', s.seqcycle)::text
  FROM pg_sequence s JOIN pg_class c ON c.oid = s.seqrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'policy', c.relname::text || '.' || p.polname::text,
    jsonb_build_object('command', p.polcmd, 'permissive', p.polpermissive,
      'using', pg_get_expr(p.polqual, p.polrelid), 'check', pg_get_expr(p.polwithcheck, p.polrelid))::text
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname <> '_prisma_migrations'
  UNION ALL
  SELECT 'extension', e.extname, to_jsonb(e.extversion)::text
  FROM pg_extension e WHERE e.extname <> 'plpgsql'
)
SELECT kind, name, definition FROM objects ORDER BY kind, name, definition
`;

export async function catalogInventory(prisma) {
  const rows = await prisma.$queryRawUnsafe(inventorySql);
  return rows.map(({ kind, name, definition }) => ({ kind, name, definition }));
}

export async function catalogFingerprint(prisma) {
  const inventory = await catalogInventory(prisma);
  const sha256 = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
  return { sha256, inventory };
}

const partialUniqueIndexes = [
  ['FinancialCorrectionApprovedDeductionPayoutLine', 'FinancialCorrectionApprovedDeductionPayoutLine_non_cancelled_so', "(status <> 'CANCELLED'::text)"],
  ['FinancialCorrectionCreditPayoutLine', 'FinancialCorrectionCreditPayoutLine_non_cancelled_source_key', "(status <> 'CANCELLED'::text)"],
  ['FinancialCorrectionCreditSettlementLine', 'FinancialCorrectionCreditSettlementLine_active_credit_key', "(status = 'ACTIVE'::text)"],
  ['FinancialCorrectionDeductionPayoutLine', 'FinancialCorrectionDeductionPayoutLine_non_cancelled_source_key', "(status <> 'CANCELLED'::text)"],
  ['FinancialCorrectionDeductionSettlementLine', 'FinancialCorrectionDeductionSettlementLine_active_source_key', "(status = 'ACTIVE'::text)"],
];

const checkConstraints = [
  ['FinancialCorrectionApprovedDeductionCoverage', 'FinancialCorrectionApprovedDeductionCoverage_state_check'],
  ['FinancialCorrectionApprovedDeductionPayoutLine', 'FinancialCorrectionApprovedDeductionPayoutLine_state_check'],
  ['FinancialCorrectionAuthority', 'FinancialCorrectionAuthority_review_attestation_check'],
  ['FinancialCorrectionAuthority', 'FinancialCorrectionAuthority_route_check'],
  ['FinancialCorrectionBaselineClaim', 'FinancialCorrectionBaselineClaim_type_check'],
  ['FinancialCorrectionCredit', 'FinancialCorrectionCredit_amount_check'],
  ['FinancialCorrectionCreditPayoutLine', 'FinancialCorrectionCreditPayoutLine_state_check'],
  ['FinancialCorrectionCreditSettlementLine', 'FinancialCorrectionCreditSettlementLine_state_check'],
  ['FinancialCorrectionDeduction', 'FinancialCorrectionDeduction_amount_check'],
  ['FinancialCorrectionDeductionPayoutLine', 'FinancialCorrectionDeductionPayoutLine_state_check'],
  ['FinancialCorrectionDeductionSettlementLine', 'FinancialCorrectionDeductionSettlementLine_state_check'],
  ['FinancialCorrectionZeroNetAcknowledgement', 'FinancialCorrectionZeroNetAcknowledgement_zero_effect_check'],
  ['VendorBalanceEvent', 'VendorBalanceEvent_correction_source_check'],
];

const triggerFunctions = [
  ['FinancialCorrectionApprovedDeductionCoverage', 'FinancialCorrectionApprovedDeductionCoverage_source_guard', 'checkApprovedDeductionCoverage'],
  ['FinancialCorrectionCredit', 'FinancialCorrectionCredit_direction_guard', 'checkFinancialCorrectionEffectDirection'],
  ['FinancialCorrectionDeduction', 'FinancialCorrectionDeduction_direction_guard', 'checkFinancialCorrectionDeductionDirection'],
  ['VendorBalanceEvent', 'VendorBalanceEvent_correction_direction_guard', 'checkFinancialCorrectionDebtDirection'],
];

export function assertRequiredSafeguards(inventory) {
  const lookup = new Map(inventory.map((item) => [`${item.kind}:${item.name}`, item.definition]));
  const object = (kind, name) => {
    const definition = lookup.get(`${kind}:${name}`);
    if (!definition) throw new Error(`Missing PostgreSQL safeguard ${kind}:${name}`);
    return definition;
  };
  const quotedTable = (name) => `"${name}"`;
  for (const [table, index, predicate] of partialUniqueIndexes) {
    const definition = JSON.parse(object('index', `${quotedTable(table)}.${index}`));
    if (!definition.unique || definition.predicate !== predicate || !definition.definition.includes('CREATE UNIQUE INDEX')) {
      throw new Error(`Partial unique index definition changed: ${index}`);
    }
  }
  for (const [table, constraint] of checkConstraints) {
    const definition = JSON.parse(object('constraint', `${quotedTable(table)}.${constraint}`));
    if (definition.type !== 'c' || !definition.definition.startsWith('CHECK') || !definition.validated) {
      throw new Error(`CHECK definition changed: ${constraint}`);
    }
  }
  for (const [table, trigger, functionName] of triggerFunctions) {
    const functionDefinition = JSON.parse(object('function', `${functionName}()`));
    if (!functionDefinition.includes('RAISE EXCEPTION')) throw new Error(`Safeguard function changed: ${functionName}`);
    const definition = JSON.parse(object('trigger', `${quotedTable(table)}.${trigger}`));
    if (!definition.includes(functionName)) throw new Error(`Trigger binding changed: ${trigger}`);
  }
  const historical = JSON.parse(object('index', '"SettlementCommissionInvoice".SettlementCommissionInvoice_active_settlement_provider_key'));
  if (!historical.unique || !historical.predicate.includes("status <> 'CANCELLED'")) {
    throw new Error('Historical settlement commission invoice partial index definition changed.');
  }
}
