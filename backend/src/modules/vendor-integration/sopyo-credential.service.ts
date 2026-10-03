import { prisma } from '../../db/prisma.js';
import { decryptSopyoCredential, encryptSopyoCredential, SopyoCredentialError } from './sopyo-credential.crypto.js';

type CredentialDb = Pick<typeof prisma, 'vendor' | 'sopyoVendorCredential'>;

function normalizedVendorId(vendorId: string): string {
  const normalized = vendorId.trim();
  if (!normalized) throw new SopyoCredentialError('Vendor ID is required.');
  return normalized;
}

export async function saveOrReplaceSopyoCredential(
  vendorId: string,
  plaintextToken: string,
  db: CredentialDb = prisma,
) {
  const id = normalizedVendorId(vendorId);
  if (!plaintextToken.trim()) throw new SopyoCredentialError('Sopyo API token is required.');
  const encrypted = encryptSopyoCredential(plaintextToken, id);
  const vendor = await db.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!vendor) throw new SopyoCredentialError('Vendor not found.');
  const record = await db.sopyoVendorCredential.upsert({
    where: { vendorId: id },
    create: { vendorId: id, ...encrypted },
    update: encrypted,
    select: { id: true, vendorId: true, createdAt: true, updatedAt: true },
  });
  return { ...record, configured: true };
}

export async function hasSopyoCredential(vendorId: string, db: CredentialDb = prisma): Promise<boolean> {
  const record = await db.sopyoVendorCredential.findUnique({
    where: { vendorId: normalizedVendorId(vendorId) },
    select: { id: true },
  });
  return record !== null;
}

/** Internal backend use only. Never return this value from an API or log it. */
export async function getDecryptedSopyoCredentialForInternalUse(
  vendorId: string,
  db: CredentialDb = prisma,
): Promise<string> {
  const id = normalizedVendorId(vendorId);
  const record = await db.sopyoVendorCredential.findUnique({
    where: { vendorId: id },
    select: { ciphertext: true, iv: true, authTag: true },
  });
  if (!record) throw new SopyoCredentialError('Sopyo credential is not configured for this vendor.');
  return decryptSopyoCredential(record, id);
}
