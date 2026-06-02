ALTER TABLE "ShopifyOrder"
ADD COLUMN "shopifyCreatedAt" TIMESTAMP(3),
ADD COLUMN "currency" TEXT,
ADD COLUMN "financialStatus" TEXT,
ADD COLUMN "paymentGatewayName" TEXT,
ADD COLUMN "shippingAmount" DECIMAL(10, 2),
ADD COLUMN "discountAmount" DECIMAL(10, 2),
ADD COLUMN "orderNote" TEXT,
ADD COLUMN "orderTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "billingFullName" TEXT,
ADD COLUMN "billingCompany" TEXT,
ADD COLUMN "billingPhone" TEXT,
ADD COLUMN "billingCity" TEXT,
ADD COLUMN "billingDistrict" TEXT,
ADD COLUMN "billingAddress1" TEXT,
ADD COLUMN "billingAddress2" TEXT,
ADD COLUMN "billingPostcode" TEXT;

ALTER TABLE "ShopifyOrderLineItem"
ADD COLUMN "shopifyProductId" TEXT,
ADD COLUMN "unitPriceVatIncluded" DECIMAL(10, 2),
ADD COLUMN "lineTotalVatIncluded" DECIMAL(10, 2),
ADD COLUMN "vatRate" DECIMAL(5, 2);
