import { createHash } from 'node:crypto';
import { prisma } from '../src/db/prisma.js';

type SeedUserInput = {
  email: string;
  name: string;
  role: 'ADMIN' | 'VENDOR';
  vendorIds: string[];
};

type SeedVendorInput = {
  id: string;
  name: string;
  status: string;
};

const vendors: SeedVendorInput[] = [
  { id: 'yalispor', name: 'Yalı Spor', status: 'active' },
  { id: 'sporjinal', name: 'Sporjinal', status: 'active' },
  { id: 'sporvol', name: 'Sporvol', status: 'active' },
];

const users: SeedUserInput[] = [
  {
    email: 'admin@demo.com',
    name: 'Demo Admin',
    role: 'ADMIN',
    vendorIds: ['yalispor', 'sporjinal', 'sporvol'],
  },
  {
    email: 'yalispor@demo.com',
    name: 'Yalı Spor User',
    role: 'VENDOR',
    vendorIds: ['yalispor'],
  },
  {
    email: 'sporjinal@demo.com',
    name: 'Sporjinal User',
    role: 'VENDOR',
    vendorIds: ['sporjinal'],
  },
  {
    email: 'sporvol@demo.com',
    name: 'Sporvol User',
    role: 'VENDOR',
    vendorIds: ['sporvol'],
  },
];

const shopifyOrderSeed = {
  id: 'shopify-order-internal-1001',
  sourceShopifyOrderId: '1001',
  sourceShopifyOrderNumber: '#1001',
  customerName: 'Demo Customer',
};

const shopifyLineItemsSeed = [
  {
    id: 'shopify-line-item-1001-a',
    sourceLineItemId: '1001-li-a',
    sourceVariantId: '394053-103-36,5',
    sku: '394053-103-36,5',
    title: 'SKU123 / 36,5',
    quantity: 1,
    unitPrice: '120.00',
    originalVendorId: 'yalispor',
  },
  {
    id: 'shopify-line-item-1001-b',
    sourceLineItemId: '1001-li-b',
    sourceVariantId: '394053-103-36',
    sku: '394053-103-36',
    title: 'SKU123 / 36',
    quantity: 1,
    unitPrice: '135.00',
    originalVendorId: 'sporjinal',
  },
] as const;

function makeDemoPasswordHash(password: string) {
  // Demo-only deterministic hash. Not suitable for production auth storage.
  return `demo_sha256_v1:${createHash('sha256').update(`vendor-dashboard-demo:${password}`).digest('hex')}`;
}

async function runSeed() {
  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: { id: vendor.id },
      update: { name: vendor.name, status: vendor.status },
      create: vendor,
    });
  }

  const demoPasswordHash = makeDemoPasswordHash('demo123');

  for (const user of users) {
    const createdOrUpdatedUser = await prisma.user.upsert({
      where: { email: user.email },
      update: {
        name: user.name,
        role: user.role,
        status: 'active',
        passwordHash: demoPasswordHash,
      },
      create: {
        email: user.email,
        name: user.name,
        role: user.role,
        status: 'active',
        passwordHash: demoPasswordHash,
      },
    });

    await prisma.userVendorAccess.createMany({
      data: user.vendorIds.map((vendorId) => ({
        userId: createdOrUpdatedUser.id,
        vendorId,
      })),
      skipDuplicates: true,
    });
  }

  await prisma.shopifyOrder.upsert({
    where: { sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId },
    update: {
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      customerName: shopifyOrderSeed.customerName,
    },
    create: {
      id: shopifyOrderSeed.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      customerName: shopifyOrderSeed.customerName,
    },
  });

  for (const lineItem of shopifyLineItemsSeed) {
    await prisma.shopifyOrderLineItem.upsert({
      where: { id: lineItem.id },
      update: {
        sourceLineItemId: lineItem.sourceLineItemId,
        sourceVariantId: lineItem.sourceVariantId,
        sku: lineItem.sku,
        title: lineItem.title,
        quantity: lineItem.quantity,
        unitPrice: lineItem.unitPrice,
        originalVendorId: lineItem.originalVendorId,
      },
      create: {
        ...lineItem,
        shopifyOrderId: shopifyOrderSeed.id,
      },
    });
  }

  const yaliAllocation = await prisma.vendorAllocation.upsert({
    where: { id: 'alloc-yalispor-1001' },
    update: {
      sourceShopifyOrderId: shopifyOrderSeed.id,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      originalVendorId: 'yalispor',
      assignedVendorId: 'yalispor',
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      fulfillmentStatus: 'Processing',
      shippingStatus: 'Awaiting Shipment',
      carrier: null,
      trackingNumber: null,
    },
    create: {
      id: 'alloc-yalispor-1001',
      sourceShopifyOrderId: shopifyOrderSeed.id,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      originalVendorId: 'yalispor',
      assignedVendorId: 'yalispor',
      allocationStatus: 'ACTIVE',
      reassignmentRequired: false,
      fulfillmentStatus: 'Processing',
      shippingStatus: 'Awaiting Shipment',
    },
  });

  const sporjinalAllocation = await prisma.vendorAllocation.upsert({
    where: { id: 'alloc-sporjinal-1001' },
    update: {
      sourceShopifyOrderId: shopifyOrderSeed.id,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      originalVendorId: 'sporjinal',
      assignedVendorId: 'sporjinal',
      allocationStatus: 'FULFILLED',
      reassignmentRequired: false,
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'In Transit',
      carrier: 'Yurtici Kargo',
      trackingNumber: 'TRK-1001-SJ',
    },
    create: {
      id: 'alloc-sporjinal-1001',
      sourceShopifyOrderId: shopifyOrderSeed.id,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      originalVendorId: 'sporjinal',
      assignedVendorId: 'sporjinal',
      allocationStatus: 'FULFILLED',
      reassignmentRequired: false,
      fulfillmentStatus: 'Fulfilled',
      shippingStatus: 'In Transit',
      carrier: 'Yurtici Kargo',
      trackingNumber: 'TRK-1001-SJ',
    },
  });

  await prisma.vendorAllocationLineItem.upsert({
    where: {
      vendorAllocationId_shopifyLineItemId: {
        vendorAllocationId: yaliAllocation.id,
        shopifyLineItemId: 'shopify-line-item-1001-a',
      },
    },
    update: {
      quantity: 1,
      lineAmount: '120.00',
    },
    create: {
      vendorAllocationId: yaliAllocation.id,
      shopifyLineItemId: 'shopify-line-item-1001-a',
      quantity: 1,
      lineAmount: '120.00',
    },
  });

  await prisma.vendorAllocationLineItem.upsert({
    where: {
      vendorAllocationId_shopifyLineItemId: {
        vendorAllocationId: sporjinalAllocation.id,
        shopifyLineItemId: 'shopify-line-item-1001-b',
      },
    },
    update: {
      quantity: 1,
      lineAmount: '135.00',
    },
    create: {
      vendorAllocationId: sporjinalAllocation.id,
      shopifyLineItemId: 'shopify-line-item-1001-b',
      quantity: 1,
      lineAmount: '135.00',
    },
  });

  await prisma.allocationAssignmentHistory.upsert({
    where: { id: 'assignment-history-yalispor-1001' },
    update: {
      action: 'assigned',
      fromVendorId: null,
      toVendorId: 'yalispor',
      reason: 'Initial vendor metafield allocation',
    },
    create: {
      id: 'assignment-history-yalispor-1001',
      vendorAllocationId: yaliAllocation.id,
      action: 'assigned',
      fromVendorId: null,
      toVendorId: 'yalispor',
      reason: 'Initial vendor metafield allocation',
    },
  });

  await prisma.allocationAssignmentHistory.upsert({
    where: { id: 'assignment-history-sporjinal-1001' },
    update: {
      action: 'assigned',
      fromVendorId: null,
      toVendorId: 'sporjinal',
      reason: 'Initial vendor metafield allocation',
    },
    create: {
      id: 'assignment-history-sporjinal-1001',
      vendorAllocationId: sporjinalAllocation.id,
      action: 'assigned',
      fromVendorId: null,
      toVendorId: 'sporjinal',
      reason: 'Initial vendor metafield allocation',
    },
  });

  await prisma.returnRecord.upsert({
    where: { id: 'return-yalispor-1001' },
    update: {
      vendorAllocationId: yaliAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      status: 'approved',
      reason: 'size_issue',
    },
    create: {
      id: 'return-yalispor-1001',
      vendorAllocationId: yaliAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      status: 'approved',
      reason: 'size_issue',
    },
  });

  await prisma.returnRecord.upsert({
    where: { id: 'return-sporjinal-1001' },
    update: {
      vendorAllocationId: sporjinalAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      status: 'pending',
      reason: 'damaged_item',
    },
    create: {
      id: 'return-sporjinal-1001',
      vendorAllocationId: sporjinalAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      status: 'pending',
      reason: 'damaged_item',
    },
  });

  await prisma.refundRecord.upsert({
    where: { id: 'refund-yalispor-1001' },
    update: {
      vendorAllocationId: yaliAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      sourceShopifyRefundId: '1001-rf-a',
      amount: '120.00',
      status: 'processed',
    },
    create: {
      id: 'refund-yalispor-1001',
      vendorAllocationId: yaliAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      sourceShopifyRefundId: '1001-rf-a',
      amount: '120.00',
      status: 'processed',
    },
  });

  await prisma.refundRecord.upsert({
    where: { id: 'refund-sporjinal-1001' },
    update: {
      vendorAllocationId: sporjinalAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      sourceShopifyRefundId: '1001-rf-b',
      amount: '135.00',
      status: 'pending',
    },
    create: {
      id: 'refund-sporjinal-1001',
      vendorAllocationId: sporjinalAllocation.id,
      sourceShopifyOrderId: shopifyOrderSeed.sourceShopifyOrderId,
      sourceShopifyOrderNumber: shopifyOrderSeed.sourceShopifyOrderNumber,
      sourceShopifyRefundId: '1001-rf-b',
      amount: '135.00',
      status: 'pending',
    },
  });
}

runSeed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
