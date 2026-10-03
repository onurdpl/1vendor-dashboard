import { describe, expect, it } from 'vitest';
import {
  decryptSopyoCredential,
  encryptSopyoCredential,
} from '../backend/src/modules/vendor-integration/sopyo-credential.crypto.js';

const key = Buffer.alloc(32, 7).toString('base64'); // Fake test-only key.
const otherKey = Buffer.alloc(32, 8).toString('base64');
const token = 'fake-test-sopyo-token';

describe('Sopyo credential AES-256-GCM', () => {
  it('encrypts with a fresh nonce and decrypts only under the same vendor and key', () => {
    const first = encryptSopyoCredential(token, 'vendor-a', key);
    const second = encryptSopyoCredential(token, 'vendor-a', key);
    expect(decryptSopyoCredential(first, 'vendor-a', key)).toBe(token);
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ciphertext).equals(Buffer.from(second.ciphertext))).toBe(false);
    expect(JSON.stringify(first)).not.toContain(token);
    expect(() => decryptSopyoCredential(first, 'vendor-a', otherKey)).toThrow('cannot be decrypted');
    expect(() => decryptSopyoCredential(first, 'vendor-b', key)).toThrow('cannot be decrypted');
  });

  it('rejects ciphertext and tag tampering without exposing secrets', () => {
    const encrypted = encryptSopyoCredential(token, 'vendor-a', key);
    const ciphertext = Buffer.from(encrypted.ciphertext);
    ciphertext[0] ^= 1;
    const tag = Buffer.from(encrypted.authTag);
    tag[0] ^= 1;
    for (const changed of [{ ...encrypted, ciphertext }, { ...encrypted, authTag: tag }]) {
      let message = '';
      try { decryptSopyoCredential(changed, 'vendor-a', key); } catch (error) { message = (error as Error).message; }
      expect(message).toBe('Sopyo credential cannot be decrypted.');
      expect(message).not.toContain(token);
      expect(message).not.toContain(key);
    }
  });

  it('fails closed without a key or with malformed key material', () => {
    const encrypted = encryptSopyoCredential(token, 'vendor-a', key);
    for (const bad of ['', 'not-base64', Buffer.alloc(31).toString('base64'), `${key} `]) {
      expect(() => encryptSopyoCredential(token, 'vendor-a', bad)).toThrow();
      expect(() => decryptSopyoCredential(encrypted, 'vendor-a', bad)).toThrow();
    }
  });
});
