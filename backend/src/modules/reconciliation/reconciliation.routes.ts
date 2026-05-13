import type { FastifyInstance } from 'fastify';
import type { AppEnv } from '../../config/env.js';
import { createAuthMiddleware } from '../auth/auth.middleware.js';
import { createAuthService } from '../auth/auth.service.js';
import { createReconciliationService } from './reconciliation.service.js';
import {
  createOperationalJob,
  markOperationalJobCompleted,
  markOperationalJobFailed,
  markOperationalJobProcessing,
} from '../operational-jobs/operational-jobs.service.js';

export function registerReconciliationRoutes(app: FastifyInstance, env: AppEnv) {
  const authService = createAuthService(env);
  const authMiddleware = createAuthMiddleware(authService);
  const reconciliationService = createReconciliationService(env);

  const createReconciliationJob = async (input: {
    vendorAllocationId?: string | null;
    sourceShopifyOrderId?: string | null;
  }) => {
    try {
      return await createOperationalJob({
        jobType: 'reconciliation',
        vendorAllocationId: input.vendorAllocationId ?? null,
        sourceShopifyOrderId: input.sourceShopifyOrderId ?? null,
        priority: 5,
      });
    } catch (error) {
      app.log.error({ error, input }, 'Operational reconciliation job persistence failed; continuing inline reconciliation.');
      return null;
    }
  };

  const markJobProcessing = async (jobId: string | null | undefined) => {
    try {
      await markOperationalJobProcessing(jobId);
    } catch (error) {
      app.log.error({ error, operationalJobId: jobId }, 'Failed to mark reconciliation job processing.');
    }
  };

  const markJobCompleted = async (jobId: string | null | undefined) => {
    try {
      await markOperationalJobCompleted(jobId);
    } catch (error) {
      app.log.error({ error, operationalJobId: jobId }, 'Failed to mark reconciliation job completed.');
    }
  };

  const markJobFailed = async (jobId: string | null | undefined, error: unknown) => {
    try {
      await markOperationalJobFailed(jobId, error);
    } catch (jobError) {
      app.log.error({ error: jobError, operationalJobId: jobId }, 'Failed to mark reconciliation job failed.');
    }
  };

  app.post<{ Params: { allocationId: string } }>(
    '/admin/reconciliation/orders/:allocationId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const operationalJob = await createReconciliationJob({
        vendorAllocationId: request.params.allocationId,
      });
      await markJobProcessing(operationalJob?.id);

      let result;
      try {
        result = await reconciliationService.reconcileAllocation(request.params.allocationId);
      } catch (error) {
        await markJobFailed(operationalJob?.id, error);
        throw error;
      }

      if (!result) {
        await markJobFailed(operationalJob?.id, 'Allocation not found or missing Shopify order linkage.');
        return reply.code(404).send({ message: 'Allocation not found or missing Shopify order linkage.' });
      }

      await markJobCompleted(operationalJob?.id);
      return result;
    },
  );

  app.post<{ Params: { shopifyOrderId: string } }>(
    '/admin/reconciliation/shopify-order/:shopifyOrderId',
    {
      preHandler: [authMiddleware.authenticateRequest],
    },
    async (request, reply) => {
      if (request.authUser?.role !== 'admin') {
        return reply.code(403).send({ message: 'Forbidden' });
      }

      const operationalJob = await createReconciliationJob({
        sourceShopifyOrderId: request.params.shopifyOrderId,
      });
      await markJobProcessing(operationalJob?.id);

      let result;
      try {
        result = await reconciliationService.reconcileShopifyOrder(request.params.shopifyOrderId);
      } catch (error) {
        await markJobFailed(operationalJob?.id, error);
        throw error;
      }

      if (!result) {
        await markJobFailed(operationalJob?.id, 'Shopify order not found.');
        return reply.code(404).send({ message: 'Shopify order not found.' });
      }

      await markJobCompleted(operationalJob?.id);
      return result;
    },
  );
}
