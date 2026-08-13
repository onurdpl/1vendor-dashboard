import type { Prisma } from '@prisma/client';

type ShopifyOrderFinancialStatusStore = {
  shopifyOrder: {
    update(args: Prisma.ShopifyOrderUpdateArgs): Promise<unknown>;
  };
};

export function normalizeCanonicalShopifyOrderFinancialStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? '';
  return normalized || null;
}

export async function synchronizeCanonicalShopifyOrderFinancialStatus(input: {
  db: ShopifyOrderFinancialStatusStore;
  shopifyOrder: {
    id: string;
    financialStatus: string | null;
  };
  canonicalFinancialStatus: string | null | undefined;
}) {
  const canonicalFinancialStatus = normalizeCanonicalShopifyOrderFinancialStatus(
    input.canonicalFinancialStatus,
  );
  const localFinancialStatus = normalizeCanonicalShopifyOrderFinancialStatus(
    input.shopifyOrder.financialStatus,
  );

  if (!canonicalFinancialStatus || localFinancialStatus === canonicalFinancialStatus) {
    return {
      updated: false,
      financialStatus: canonicalFinancialStatus,
    };
  }

  await input.db.shopifyOrder.update({
    where: {
      id: input.shopifyOrder.id,
    },
    data: {
      financialStatus: canonicalFinancialStatus,
    },
  });

  return {
    updated: true,
    financialStatus: canonicalFinancialStatus,
  };
}
