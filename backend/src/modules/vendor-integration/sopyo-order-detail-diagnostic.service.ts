import { prisma } from '../../db/prisma.js';
import { getDecryptedSopyoCredentialForInternalUse } from './sopyo-credential.service.js';
import { createSopyoDeliveryClient, SopyoDeliveryClientError } from './sopyo-delivery.client.js';
import type { SopyoDetailResponseStructure } from './sopyo-delivery.client.js';

type Reason = 'LOCAL_VALIDATION_FAILED' | 'CREDENTIAL_FAILED' | 'AUTH_FAILED' |
  'DETAIL_NOT_FOUND' | 'DETAIL_HTTP_ERROR' | 'DETAIL_JSON_INVALID' | 'DETAIL_SCHEMA_MISMATCH' |
  'NETWORK_ERROR' | 'PROVIDER_IDENTITY_MISMATCH' | 'UNKNOWN';
type Stage = 'LOCAL_VALIDATION' | 'PUSH_LOAD' | 'CREDENTIAL' | 'AUTH' |
  'DETAIL_GET' | 'DETAIL_PARSE' | 'IDENTITY_CHECK';
type Failure = {
  SOPYO_ORDER_DETAIL_READ: 'FAILED'; reason: Reason; stage: Stage; httpStatus?: number;
  detailStructure?: SopyoDetailResponseStructure;
};
type Success = { id: number; orderCode: string; orderType: string; orderStatus: number;
  cargoTrackingNumber: string | null; cargoCompany: string | null };

function withoutCredentialText(value: string | null | undefined, apiToken: string, bearer: string): string | null {
  if (!value || [apiToken, bearer].some((secret) => secret && value.toLowerCase().includes(secret.toLowerCase()))) return null;
  return value;
}

function failed(reason: Reason, stage: Stage, httpStatus?: number, detailStructure?: SopyoDetailResponseStructure): Failure {
  return { SOPYO_ORDER_DETAIL_READ: 'FAILED', reason, stage,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(detailStructure === undefined ? {} : { detailStructure }) };
}

type DetailClient = Pick<ReturnType<typeof createSopyoDeliveryClient>, 'authenticate' | 'orderById'>;

/** Operator-only read: database SELECT, Sopyo login, and at most one order-detail GET. */
export async function readSopyoOrderDetailDiagnostic(options: {
  pushId?: string;
  databaseUrl?: string;
  db?: Pick<typeof prisma, 'sopyoOrderPush'>;
  loadCredential?: (vendorId: string) => Promise<string>;
  client?: DetailClient;
}): Promise<Success | Failure> {
  const pushId = options.pushId?.trim();
  if (!pushId || !/^c[a-z0-9]{20,40}$/.test(pushId) || !options.databaseUrl) {
    return failed('LOCAL_VALIDATION_FAILED', 'LOCAL_VALIDATION');
  }
  let push;
  try {
    push = await (options.db ?? prisma).sopyoOrderPush.findUnique({
      where: { id: pushId },
      select: {
        vendorAllocationId: true, assignedVendorId: true, orderCode: true,
        status: true, sopyoOrderId: true,
        vendorAllocation: { select: {
          id: true, assignedVendorId: true, outboundMethodSnapshot: true,
          outboundIntegrationProviderSnapshot: true,
        } },
      },
    });
  } catch {
    return failed('UNKNOWN', 'PUSH_LOAD');
  }
  if (!push || push.status !== 'SUCCEEDED' || !push.sopyoOrderId ||
      !/^[1-9]\d{0,15}$/.test(push.sopyoOrderId) ||
      !Number.isSafeInteger(Number(push.sopyoOrderId)) ||
      String(Number(push.sopyoOrderId)) !== push.sopyoOrderId ||
      push.vendorAllocationId !== push.vendorAllocation.id ||
      push.assignedVendorId !== push.vendorAllocation.assignedVendorId ||
      push.orderCode !== push.vendorAllocation.id ||
      push.vendorAllocation.outboundMethodSnapshot !== 'VENDOR_INTEGRATION' ||
      push.vendorAllocation.outboundIntegrationProviderSnapshot !== 'SOPYO') {
    return failed('LOCAL_VALIDATION_FAILED', 'PUSH_LOAD');
  }
  let apiToken: string;
  try {
    apiToken = await (options.loadCredential ?? getDecryptedSopyoCredentialForInternalUse)(push.assignedVendorId);
  } catch {
    return failed('CREDENTIAL_FAILED', 'CREDENTIAL');
  }
  const client = options.client ?? createSopyoDeliveryClient();
  let bearer: string;
  try {
    bearer = await client.authenticate(apiToken);
  } catch (error) {
    if (error instanceof SopyoDeliveryClientError) {
      if (error.failureKind === 'NETWORK') return failed('NETWORK_ERROR', 'AUTH');
      if (error.category === 'AUTH' || error.category === 'MALFORMED') {
        return failed('AUTH_FAILED', 'AUTH', error.httpStatus);
      }
    }
    return failed('UNKNOWN', 'AUTH');
  }
  let detail: Awaited<ReturnType<DetailClient['orderById']>>;
  try {
    detail = await client.orderById(bearer, push.sopyoOrderId, { includeCargo: true });
  } catch (error) {
    if (error instanceof SopyoDeliveryClientError) {
      if (error.failureKind === 'NETWORK') return failed('NETWORK_ERROR', 'DETAIL_GET');
      if (error.failureKind === 'HTTP') {
        return error.httpStatus === 404
          ? failed('DETAIL_NOT_FOUND', 'DETAIL_GET', 404)
          : failed('DETAIL_HTTP_ERROR', 'DETAIL_GET', error.httpStatus);
      }
      if (error.failureKind === 'INVALID_JSON') return failed('DETAIL_JSON_INVALID', 'DETAIL_PARSE', error.httpStatus);
      if (error.failureKind === 'INVALID_BODY') return failed('DETAIL_SCHEMA_MISMATCH', 'DETAIL_PARSE',
        error.httpStatus, error.detailStructure);
    }
    return failed('UNKNOWN', 'DETAIL_GET');
  }
  if (String(detail.id) !== push.sopyoOrderId || detail.orderCode !== push.orderCode ||
      detail.orderType !== 'SOPYOAPI') return failed('PROVIDER_IDENTITY_MISMATCH', 'IDENTITY_CHECK', 200);
  return { id: detail.id, orderCode: detail.orderCode,
    orderType: detail.orderType, orderStatus: detail.orderStatus,
    cargoTrackingNumber: withoutCredentialText(detail.cargoTrackingNumber, apiToken, bearer),
    cargoCompany: withoutCredentialText(detail.cargoCompany, apiToken, bearer) };
}
