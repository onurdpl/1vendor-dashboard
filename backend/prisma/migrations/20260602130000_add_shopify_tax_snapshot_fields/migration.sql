ALTER TABLE "ShopifyOrder"
ADD COLUMN "taxesIncluded" BOOLEAN,
ADD COLUMN "orderTaxAmount" DECIMAL(10, 2);

ALTER TABLE "ShopifyOrderLineItem"
ADD COLUMN "lineTaxAmount" DECIMAL(10, 2);
