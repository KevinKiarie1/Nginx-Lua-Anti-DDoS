// ============================================================
// CRYPTO SERVICE — AES-256-GCM Credential Encryption
// ============================================================
// All account credentials are stored encrypted at rest.
// Uses AES-256-GCM (authenticated encryption) to prevent
// both decryption and tampering of stored credentials.
//
// The encryption key is derived from the ENCRYPTION_KEY env var
// using SHA-256 to ensure exactly 32 bytes regardless of input.
// ============================================================

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(private readonly config: ConfigService) {
    const hexKey = this.config.get<string>('app.encryptionKey')!;
    // Derive a consistent 32-byte key via SHA-256
    this.key = crypto.createHash('sha256').update(hexKey).digest();
  }

  /** Encrypt a plaintext string. Returns base64(iv + authTag + ciphertext). */
  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);

    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack: IV (16 bytes) + AuthTag (16 bytes) + Ciphertext
    const packed = Buffer.concat([iv, authTag, encrypted]);
    return packed.toString('base64');
  }

  /** Decrypt a base64(iv + authTag + ciphertext) string. */
  decrypt(encoded: string): string {
    const packed = Buffer.from(encoded, 'base64');
    const iv = packed.subarray(0, IV_LENGTH);
    const authTag = packed.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const ciphertext = packed.subarray(IV_LENGTH + AUTH_TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  }

  /** Encrypt a JSON object */
  encryptJson(obj: Record<string, unknown>): string {
    return this.encrypt(JSON.stringify(obj));
  }

  /** Decrypt to a JSON object */
  decryptJson(encoded: string): Record<string, unknown> {
    return JSON.parse(this.decrypt(encoded));
  }
}
