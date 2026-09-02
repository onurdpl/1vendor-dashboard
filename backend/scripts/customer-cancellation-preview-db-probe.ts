import { prisma } from '../src/db/prisma.js';

async function main() {
  const [database] = await prisma.$queryRaw<{ database_name: string }[]>`
    select current_database() as database_name
  `;
  const order1002Count = await prisma.shopifyOrder.count({
    where: { sourceShopifyOrderNumber: { in: ['1002', '#1002'] } },
  });
  const requestCount = await prisma.customerCancellationRequest.count();

  console.log('Customer cancellation preview Prisma probe passed.');
  console.log(`Database: ${database?.database_name ?? '[unknown]'}`);
  console.log(`Order #1002 present: ${order1002Count > 0 ? 'YES' : 'NO'}`);
  console.log(`CustomerCancellationRequest count: ${requestCount}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
