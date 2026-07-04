import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey } from "../src/crypto/key-encryption.js";

describe("key-encryption (AES-256-GCM at-rest storage for BYOK keys)", () => {
  it("round-trips a plaintext key through encrypt/decrypt", () => {
    const key = randomBytes(32);
    const blob = encryptApiKey("sk-super-secret-value", key);
    expect(decryptApiKey(blob, key)).toBe("sk-super-secret-value");
  });

  it("never stores the plaintext key as a literal substring of the ciphertext blob", () => {
    const key = randomBytes(32);
    const plaintext = "sk-super-secret-value";
    const blob = encryptApiKey(plaintext, key);
    expect(blob.toString("latin1")).not.toContain(plaintext);
    expect(blob.toString("base64")).not.toContain(plaintext);
  });

  it("produces a different ciphertext each time (random iv) even for the same plaintext/key", () => {
    const key = randomBytes(32);
    const a = encryptApiKey("same-value", key);
    const b = encryptApiKey("same-value", key);
    expect(a.equals(b)).toBe(false);
    expect(decryptApiKey(a, key)).toBe("same-value");
    expect(decryptApiKey(b, key)).toBe("same-value");
  });

  it("fails to decrypt with the wrong key instead of silently returning garbage", () => {
    const key = randomBytes(32);
    const wrongKey = randomBytes(32);
    const blob = encryptApiKey("sk-super-secret-value", key);
    expect(() => decryptApiKey(blob, wrongKey)).toThrow();
  });

  it("fails to decrypt a tampered blob (GCM auth tag catches corruption)", () => {
    const key = randomBytes(32);
    const blob = encryptApiKey("sk-super-secret-value", key);
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => decryptApiKey(tampered, key)).toThrow();
  });
});
