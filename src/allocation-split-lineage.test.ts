import { describe, expect, it } from 'vitest';
import { Prisma } from '../backend/node_modules/@prisma/client/index.js';

const allocationSplitEventModel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'AllocationSplitEvent');
const vendorAllocationModel = Prisma.dmmf.datamodel.models.find((model) => model.name === 'VendorAllocation');

function field(model: NonNullable<typeof allocationSplitEventModel>, name: string) {
  const found = model.fields.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`Expected ${model.name}.${name} to exist.`);
  }
  return found;
}

describe('allocation split lineage schema', () => {
  it('defines an authoritative allocation split event model with audit fields', () => {
    expect(allocationSplitEventModel).toBeDefined();
    if (!allocationSplitEventModel) {
      throw new Error('AllocationSplitEvent model was not generated.');
    }

    expect(field(allocationSplitEventModel, 'id').isId).toBe(true);
    expect(field(allocationSplitEventModel, 'sourceAllocationId').type).toBe('String');
    expect(field(allocationSplitEventModel, 'childAllocationId').type).toBe('String');
    expect(field(allocationSplitEventModel, 'reason').type).toBe('String');
    expect(field(allocationSplitEventModel, 'note').isRequired).toBe(false);
    expect(field(allocationSplitEventModel, 'actorUserId').isRequired).toBe(false);
    expect(field(allocationSplitEventModel, 'movedVendorAllocationLineItemIdsJson').type).toBe('Json');
    expect(field(allocationSplitEventModel, 'movedShopifyLineItemIdsJson').type).toBe('Json');
    expect(field(allocationSplitEventModel, 'metadataJson').type).toBe('Json');
  });

  it('links source and child allocations with distinct explicit relations', () => {
    expect(allocationSplitEventModel).toBeDefined();
    expect(vendorAllocationModel).toBeDefined();
    if (!allocationSplitEventModel || !vendorAllocationModel) {
      throw new Error('Allocation split relation models were not generated.');
    }

    expect(field(allocationSplitEventModel, 'sourceAllocation')).toMatchObject({
      kind: 'object',
      type: 'VendorAllocation',
      relationName: 'allocationSplitSourceAllocation',
    });
    expect(field(allocationSplitEventModel, 'childAllocation')).toMatchObject({
      kind: 'object',
      type: 'VendorAllocation',
      relationName: 'allocationSplitChildAllocation',
    });
    expect(field(vendorAllocationModel, 'sourceAllocationSplitEvents')).toMatchObject({
      kind: 'object',
      type: 'AllocationSplitEvent',
      relationName: 'allocationSplitSourceAllocation',
      isList: true,
    });
    expect(field(vendorAllocationModel, 'childAllocationSplitEvents')).toMatchObject({
      kind: 'object',
      type: 'AllocationSplitEvent',
      relationName: 'allocationSplitChildAllocation',
      isList: true,
    });
  });

  it('supports creating split lineage for one source allocation and multiple children', () => {
    const firstChildSplit: Prisma.AllocationSplitEventCreateInput = {
      sourceAllocation: { connect: { id: 'alloc-source' } },
      childAllocation: { connect: { id: 'alloc-child-1' } },
      reason: 'OUT_OF_STOCK',
      note: 'Vendor rejected one selected line item.',
      movedVendorAllocationLineItemIdsJson: ['vali-1'],
      movedShopifyLineItemIdsJson: ['shopify-line-1'],
      sourceFinanceLedgerEntry: { connect: { id: 'fin-source-sale' } },
      remainingFinanceLedgerEntry: { connect: { id: 'fin-source-sale-remainder' } },
      childFinanceLedgerEntry: { connect: { id: 'fin-child-sale' } },
      metadataJson: {
        splitMode: 'line_item_reject',
      },
    };
    const secondChildSplit: Prisma.AllocationSplitEventCreateInput = {
      sourceAllocation: { connect: { id: 'alloc-source' } },
      childAllocation: { connect: { id: 'alloc-child-2' } },
      reason: 'DAMAGED_INVENTORY',
      movedVendorAllocationLineItemIdsJson: ['vali-2'],
      movedShopifyLineItemIdsJson: ['shopify-line-2'],
    };

    expect(firstChildSplit.sourceAllocation.connect?.id).toBe('alloc-source');
    expect(firstChildSplit.childAllocation.connect?.id).toBe('alloc-child-1');
    expect(secondChildSplit.sourceAllocation.connect?.id).toBe('alloc-source');
    expect(secondChildSplit.childAllocation.connect?.id).toBe('alloc-child-2');
  });

  it('keeps historical allocations valid without split events', () => {
    expect(vendorAllocationModel).toBeDefined();
    if (!vendorAllocationModel) {
      throw new Error('VendorAllocation model was not generated.');
    }

    expect(field(vendorAllocationModel, 'sourceAllocationSplitEvents').isList).toBe(true);
    expect(field(vendorAllocationModel, 'childAllocationSplitEvents').isList).toBe(true);
    expect(vendorAllocationModel.fields.some((candidate) => candidate.name === 'splitFromAllocationId')).toBe(false);
    expect(vendorAllocationModel.fields.some((candidate) => candidate.name === 'allocationSplitEventId')).toBe(false);
  });
});
