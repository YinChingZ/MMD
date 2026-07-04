import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. At-rest format is iv (12B) || ciphertext || authTag (16B)
// concatenated into a single buffer — one column, no extra columns/JSON
// needed to carry the pieces back together on read.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

// Rotating ENCRYPTION_KEY requires re-encrypting every existing row offline
// with the old+new keys — no online rotation mechanism is planned (out of
// scope for BYOK M4 step 4).

export function encryptApiKey(plaintext: string, encryptionKey: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, encryptionKey, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, authTag]);
}

export function decryptApiKey(blob: Buffer, encryptionKey: Buffer): string {
  const iv = blob.subarray(0, IV_LENGTH);
  const authTag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8"
  );
}
