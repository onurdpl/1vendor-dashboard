import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  financeLedgerEntry: {
    findUnique: vi.fn(),
  },
  shipmentShippingCost: {
    upsert: vi.fn(),
  },
  vendorAllocation: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { upsertShipmentShippingCost } = await import('../backend/src/modules/finance/finance.service.js');

describe('shipping cost foundation', () => {
  beforeEach(() => {
    prismaMock.financeLedgerEntry.findUnique.mockReset();
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.shipmentShippingCost.upsert.mockReset();

    prismaMock.financeLedgerEntry.findUnique.mockResolvedValue({
      vendorAllocationId: 'alloc-1',
      vendorId: 'sporjinal',
      voidedAt: null,
      voidReason: null,
      supersededByLedgerId: null,
    });
    prismaMock.vendorAllocation.findUnique.mockResolvedValue({
      id: 'alloc-1',
      assignedVendorId: 'sporjinal',
      sourceShopifyOrderId: '7616544244049',
      fulfillment: {
        shopifyFulfillmentId: 'fulfillment-1',
      },
      order: {
        id: 'order-1',
      },
    });
    prismaMock.shipmentShippingCost.upsert.mockImplementation(async ({ create, update, where }) => ({
      ...create,
      ...update,
      id: where.id,
      createdAt: new Date('2026-05-13T10:00:00.000Z'),
      updatedAt: new Date('2026-05-13T10:00:00.000Z'),
    }));
  });

  it('upserts confirmed external provider cost with a deterministic duplicate-safe id', async () => {
    const input = {
      vendorId: 'sporjinal',
      financeLedgerEntryId: 'fin-sporjinal-sale-1',
      providerName: 'Cargo Co',
      providerReference: 'TRK-123',
      shippingCost: 72,
      shippingVatAmount: 12,
      status: 'confirmed' as const,
      sourceType: 'external_provider' as const,
    };

    const first = await upsertShipmentShippingCost(input);
    const second = await upsertShipmentShippingCost(input);

    expect(first).toMatchObject({
      id: 'shipcost-sporjinal-alloc-1-cargo-co-trk-123',
      vendorId: 'sporjinal',
      allocationId: 'alloc-1',
      providerName: 'Cargo Co',
      providerReference: 'TRK-123',
      shippingCost: '72.00',
      shippingVatAmount: '12.00',
      status: 'confirmed',
      sourceType: 'external_provider',
    });
    expect(second.id).toBe(first.id);
    expect(prismaMock.shipmentShippingCost.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.shipmentShippingCost.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          id: 'shipcost-sporjinal-alloc-1-cargo-co-trk-123',
        },
      }),
    );
  });

  it('rejects a shipping cost when the ledger row belongs to another vendor', async () => {
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValueOnce({
      vendorAllocationId: 'alloc-1',
      vendorId: 'other-vendor',
      voidedAt: null,
      voidReason: null,
      supersededByLedgerId: null,
    });

    await expect(
      upsertShipmentShippingCost({
        vendorId: 'sporjinal',
        financeLedgerEntryId: 'fin-other-sale-1',
        providerName: 'Cargo Co',
        shippingCost: 72,
      }),
    ).rejects.toThrow('Finance ledger row does not belong to the selected vendor.');
    expect(prismaMock.shipmentShippingCost.upsert).not.toHaveBeenCalled();
  });

  it('rejects a shipping cost when the allocation is not vendor-scoped to the selected vendor', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1',
      assignedVendorId: 'other-vendor',
      sourceShopifyOrderId: '7616544244049',
      fulfillment: null,
      order: null,
    });

    await expect(
      upsertShipmentShippingCost({
        vendorId: 'sporjinal',
        allocationId: 'alloc-1',
        providerName: 'Cargo Co',
        shippingCost: 72,
      }),
    ).rejects.toThrow('Allocation could not be found for the selected vendor.');
    expect(prismaMock.shipmentShippingCost.upsert).not.toHaveBeenCalled();
  });

  it('rejects a shipping cost when the ledger row has been voided', async () => {
    prismaMock.financeLedgerEntry.findUnique.mockResolvedValueOnce({
      vendorAllocationId: 'alloc-1',
      vendorId: 'sporjinal',
      voidedAt: new Date('2026-06-21T10:00:00.000Z'),
      voidReason: 'economic transfer superseded source ledger',
      supersededByLedgerId: 'replacement-ledger-1',
    });

    await expect(
      upsertShipmentShippingCost({
        vendorId: 'sporjinal',
        financeLedgerEntryId: 'fin-sporjinal-sale-voided',
        providerName: 'Cargo Co',
        shippingCost: 72,
      }),
    ).rejects.toThrow('Finance ledger row has been voided or superseded and cannot receive shipping cost.');
    expect(prismaMock.shipmentShippingCost.upsert).not.toHaveBeenCalled();
  });
});
