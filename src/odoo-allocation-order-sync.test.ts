import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vendorAllocation: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('../backend/src/db/prisma.js', () => ({
  prisma: prismaMock,
}));

const { syncOdooSaleOrderForAllocation } = await import('../backend/src/integrations/odoo/odooAllocationOrderSync.service.js');

const logger = {
  log: vi.fn(),
  error: vi.fn(),
};

describe('Odoo allocation sale.order sync', () => {
  beforeEach(() => {
    prismaMock.vendorAllocation.findUnique.mockReset();
    prismaMock.vendorAllocation.update.mockReset();
    logger.log.mockReset();
    logger.error.mockReset();
  });

  it('skips without touching storage when Odoo sync is disabled', async () => {
    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'false',
        ODOO_DRY_RUN: 'false',
      },
      logger,
    });

    expect(result).toEqual({ status: 'disabled', allocationId: 'alloc-1' });
    expect(prismaMock.vendorAllocation.findUnique).not.toHaveBeenCalled();
  });

  it('uses local Odoo sale.order fields for idempotency', async () => {
    prismaMock.vendorAllocation.findUnique.mockResolvedValueOnce({
      id: 'alloc-1',
      odooSaleOrderId: '42',
      odooSaleOrderName: 'SO042',
    });

    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'true',
        ODOO_DRY_RUN: 'false',
        ODOO_URL: 'https://odoo.example.test',
        ODOO_DB: 'sporgym',
        ODOO_USERNAME: 'integration@example.test',
        ODOO_API_KEY: 'secret',
        ODOO_SALE_ORDER_PARTNER_ID: '1',
      },
      logger,
    });

    expect(result).toEqual({
      status: 'skipped_existing',
      allocationId: 'alloc-1',
      odooSaleOrderId: '42',
      odooSaleOrderName: 'SO042',
    });
    expect(prismaMock.vendorAllocation.update).not.toHaveBeenCalled();
  });

  it('fails closed when no configured Odoo partner is available', async () => {
    const result = await syncOdooSaleOrderForAllocation('alloc-1', {
      env: {
        ODOO_ENABLED: 'true',
        ODOO_DRY_RUN: 'false',
        ODOO_URL: 'https://odoo.example.test',
        ODOO_DB: 'sporgym',
        ODOO_USERNAME: 'integration@example.test',
        ODOO_API_KEY: 'secret',
      },
      logger,
    });

    expect(result).toMatchObject({
      status: 'failed',
      allocationId: 'alloc-1',
    });
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('ODOO_SALE_ORDER_PARTNER_ID or ODOO_SALE_ORDER_PARTNER_NAME'));
    expect(prismaMock.vendorAllocation.findUnique).not.toHaveBeenCalled();
  });
});
