import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export class SopyoCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SopyoCredentialError';
  }
}

export type EncryptedSopyoCredential = {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  authTag: Uint8Array<ArrayBuffer>;
};

function masterKey(encodedKey: string | undefined): Buffer {
  if (!encodedKey) {
    throw new SopyoCredentialError('Sopyo credential encryption key is not configured.');
  }
  // Reject noncanonical base64, rather than letting Buffer's permissive decoder
  // silently accept malformed configuration.
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encodedKey)) {
    throw new SopyoCredentialError('Sopyo credential encryption key must be base64-encoded 32 bytes.');
  }
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new SopyoCredentialError('Sopyo credential encryption key must be base64-encoded 32 bytes.');
  }
  return key;
}

export function encryptSopyoCredential(
  plaintext: string,
  vendorId: string,
  encodedKey: string | undefined = process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY,
): EncryptedSopyoCredential {
  const key = masterKey(encodedKey);
  const plaintextBuffer = Buffer.from(plaintext, 'utf8');
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(vendorId, 'utf8'));
    return {
      ciphertext: Buffer.concat([cipher.update(plaintextBuffer), cipher.final()]),
      iv,
      authTag: cipher.getAuthTag(),
    };
  } finally {
    plaintextBuffer.fill(0);
    key.fill(0);
  }
}

export function decryptSopyoCredential(
  encrypted: EncryptedSopyoCredential,
  vendorId: string,
  encodedKey: string | undefined = process.env.SOPYO_CREDENTIAL_ENCRYPTION_KEY,
): string {
  const key = masterKey(encodedKey);
  try {
    if (encrypted.iv.length !== 12 || encrypted.authTag.length !== 16 || encrypted.ciphertext.length === 0) {
      throw new Error('Invalid encrypted record.');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.iv, { authTagLength: 16 });
    decipher.setAAD(Buffer.from(vendorId, 'utf8'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag));
    const plaintextBuffer = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
    try {
      return plaintextBuffer.toString('utf8');
    } finally {
      plaintextBuffer.fill(0);
    }
  } catch {
    throw new SopyoCredentialError('Sopyo credential cannot be decrypted.');
  } finally {
    key.fill(0);
  }
}
