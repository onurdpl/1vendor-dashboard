import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const describeWithPostgres = testDatabaseUrl ? describe : describe.skip;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function waitForAdvisoryBlock(
  database: (typeof import('../backend/src/db/prisma.js'))['prisma'],
  blockerPid: number,
  blockedPid: number,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [{ blocked }] = await database.$queryRaw<Array<{ blocked: boolean }>>`
      SELECT (${blockerPid})::integer = ANY(pg_blocking_pids((${blockedPid})::integer)) AS "blocked"
    `;
    if (blocked) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Same-order advisory blocking was not observed within ${timeoutMs}ms.`);
}

describeWithPostgres('Shopify order advisory lock with real PostgreSQL', () => {
  let database: (typeof import('../backend/src/db/prisma.js'))['prisma'];
  let acquireShopifyOrderTransactionLock: (typeof import(
    '../backend/src/modules/shopify/orders-create-ownership.service.js'
  ))['acquireShopifyOrderTransactionLock'];

  beforeAll(async () => {
    process.env.DATABASE_URL = testDatabaseUrl;
    ({ prisma: database } = await import('../backend/src/db/prisma.js'));
    ({ acquireShopifyOrderTransactionLock } = await import(
      '../backend/src/modules/shopify/orders-create-ownership.service.js'
    ));
    await database.$connect();
  });

  afterAll(async () => {
    await database?.$disconnect();
  });

  it('acquires the transaction lock without Prisma void deserialization', async () => {
    await expect(
      database.$transaction((tx) => acquireShopifyOrderTransactionLock(tx, 'phase-5i-real-postgres')),
    ).resolves.toBeUndefined();
  });

  it('serializes the same order while allowing a different order to proceed', async () => {
    const firstAcquired = deferred<number>();
    const releaseFirst = deferred<void>();
    const secondStarted = deferred<number>();
    const secondAcquired = deferred<void>();

    const firstTransaction = database.$transaction(async (tx) => {
      const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
      await acquireShopifyOrderTransactionLock(tx, 'phase-5i-same-order');
      firstAcquired.resolve(pid);
      await releaseFirst.promise;
    });

    let secondTransaction: Promise<void> | undefined;

    try {
      const firstPid = await withTimeout(firstAcquired.promise, 2_000, 'First lock acquisition');

      secondTransaction = database.$transaction(async (tx) => {
        const [{ pid }] = await tx.$queryRaw<Array<{ pid: number }>>`SELECT pg_backend_pid()::integer AS "pid"`;
        secondStarted.resolve(pid);
        await acquireShopifyOrderTransactionLock(tx, 'phase-5i-same-order');
        secondAcquired.resolve();
      });

      const secondPid = await withTimeout(secondStarted.promise, 2_000, 'Second transaction start');
      await waitForAdvisoryBlock(database, firstPid, secondPid, 2_000);
      let sameOrderPassed = false;
      void secondAcquired.promise.then(() => {
        sameOrderPassed = true;
      });
      await Promise.resolve();
      expect(sameOrderPassed).toBe(false);

      await expect(
        withTimeout(
          database.$transaction((tx) => acquireShopifyOrderTransactionLock(tx, 'phase-5i-different-order')),
          2_000,
          'Different-order lock acquisition',
        ),
      ).resolves.toBeUndefined();

      releaseFirst.resolve();
      await expect(withTimeout(secondAcquired.promise, 2_000, 'Second lock acquisition')).resolves.toBeUndefined();
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled([firstTransaction, ...(secondTransaction ? [secondTransaction] : [])]);
    }
  });
});
