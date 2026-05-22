import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12;  // 96 bits for GCM
const TAG_LENGTH = 16; // 128 bits

function getEncryptionKey(): Buffer {
  const keyHex = process.env.DATA_ENCRYPTION_KEY;
  if (!keyHex) return Buffer.alloc(0);
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== KEY_LENGTH) {
    console.error("[crypto] DATA_ENCRYPTION_KEY must be 32 bytes (64 hex chars)");
    return Buffer.alloc(0);
  }
  return key;
}

/**
 * Encrypt a plaintext string with AES-256-GCM.
 * Returns an object with base64-encoded ciphertext, iv, and auth tag.
 */
export function encrypt(plaintext: string): { ciphertext: string; iv: string; tag: string } {
  const key = getEncryptionKey();
  if (key.length === 0) return { ciphertext: plaintext, iv: "", tag: "" };

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
  };
}

/**
 * Decrypt a ciphertext previously produced by encrypt().
 * Returns the original plaintext, or null if decryption fails.
 */
export function decrypt(encrypted: { ciphertext: string; iv: string; tag: string }): string | null {
  const key = getEncryptionKey();
  if (key.length === 0) return encrypted.ciphertext;

  try {
    const iv = Buffer.from(encrypted.iv, "base64");
    const tag = Buffer.from(encrypted.tag, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}
