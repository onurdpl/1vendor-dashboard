export const PARATIKA_MARKETPLACE_MODELS = [
  'SELLER_PAYMENT_AMOUNT',
  'SELLER_COMMISSION_RATE',
] as const;

export type ParatikaMarketplaceModel = (typeof PARATIKA_MARKETPLACE_MODELS)[number];

export type ParatikaMarketplaceModelName =
  | 'seller_payment_amount_based'
  | 'seller_commission_rate_based';

export const DEFAULT_PARATIKA_MARKETPLACE_MODEL: ParatikaMarketplaceModel = 'SELLER_COMMISSION_RATE';

export function parseParatikaMarketplaceModel(value: string | undefined | null): ParatikaMarketplaceModel {
  const normalized = value?.trim().toUpperCase();
  if (!normalized) {
    return DEFAULT_PARATIKA_MARKETPLACE_MODEL;
  }

  if (PARATIKA_MARKETPLACE_MODELS.includes(normalized as ParatikaMarketplaceModel)) {
    return normalized as ParatikaMarketplaceModel;
  }

  throw new Error(
    'Invalid PARATIKA_MARKETPLACE_MODEL value. Expected SELLER_PAYMENT_AMOUNT or SELLER_COMMISSION_RATE.',
  );
}

export function paratikaMarketplaceModelName(model: ParatikaMarketplaceModel): ParatikaMarketplaceModelName {
  switch (model) {
    case 'SELLER_COMMISSION_RATE':
      return 'seller_commission_rate_based';
    case 'SELLER_PAYMENT_AMOUNT':
    default:
      return 'seller_payment_amount_based';
  }
}
