import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * Encryption utility for securing sensitive data like access tokens.
 * 
 * Supports two formats:
 * 1. Legacy AES-256-CBC: Used by the frontend app (iv:ciphertext in hex)
 * 2. Current AES-256-GCM: Used by this backend (salt+iv+authTag+ciphertext in base64)
 * 
 * The encryption key is derived from the ENCRYPTION_KEY environment variable.
 */

const ALGORITHM = 'aes-256-gcm';
const LEGACY_ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 16; // 128 bits
const AUTH_TAG_LENGTH = 16; // 128 bits (GCM only)
const SALT_LENGTH = 32;

/**
 * Get the legacy encryption key.
 * The legacy system uses the first 32 characters of ENCRYPTION_KEY, padded with '0'.
 */
function getLegacyEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  
  if (!secret) {
    throw new Error(
      'Missing ENCRYPTION_KEY environment variable. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }
  
  // Legacy key derivation: first 32 chars, padded with '0' if shorter
  return Buffer.from(secret.slice(0, 32).padEnd(32, '0'));
}

/**
 * Get the encryption key from environment variable.
 * The key is derived using scrypt for added security.
 */
function getEncryptionKey(salt: Buffer): Buffer {
  const secret = process.env.ENCRYPTION_KEY;
  
  if (!secret) {
    throw new Error(
      'Missing ENCRYPTION_KEY environment variable. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }
  
  // Derive a proper key from the secret using scrypt
  return scryptSync(secret, salt, KEY_LENGTH);
}

/**
 * Encrypt a plaintext string.
 * 
 * @param plaintext - The string to encrypt
 * @returns Base64-encoded encrypted string (format: salt:iv:authTag:ciphertext)
 */
export function encrypt(plaintext: string): string {
  // Generate random salt and IV
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  
  // Derive key from secret using the salt
  const key = getEncryptionKey(salt);
  
  // Create cipher and encrypt
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  
  // Get the auth tag for GCM
  const authTag = cipher.getAuthTag();
  
  // Combine all parts: salt:iv:authTag:ciphertext
  const combined = Buffer.concat([salt, iv, authTag, encrypted]);
  
  return combined.toString('base64');
}

/**
 * Decrypt an encrypted string.
 * 
 * Supports two formats:
 * 1. Legacy AES-256-CBC: "iv:ciphertext" (hex-encoded, from frontend app)
 * 2. Current AES-256-GCM: base64 string with salt+iv+authTag+ciphertext
 * 
 * @param encryptedData - Encrypted string (either format)
 * @returns Decrypted plaintext string
 */
export function decrypt(encryptedData: string): string {
  // Check if this is the legacy hex format (contains colons)
  if (encryptedData.includes(':')) {
    // Legacy format: iv:ciphertext (hex-encoded, AES-256-CBC)
    const parts = encryptedData.split(':');
    if (parts.length !== 2) {
      throw new Error(`Invalid legacy encrypted data format: expected 2 colon-separated parts, got ${parts.length}`);
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const ciphertext = Buffer.from(parts[1], 'hex');
    const key = getLegacyEncryptionKey();
    
    // Legacy uses AES-256-CBC (no auth tag)
    const decipher = createDecipheriv(LEGACY_ALGORITHM, key, iv);
    let decrypted = decipher.update(ciphertext, undefined, 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } else {
    // Current format: base64-encoded concatenated binary (AES-256-GCM with salt for scrypt)
    const combined = Buffer.from(encryptedData, 'base64');
    
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const authTag = combined.subarray(
      SALT_LENGTH + IV_LENGTH, 
      SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH
    );
    const ciphertext = combined.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
    
    // Current format uses scrypt key derivation
    const key = getEncryptionKey(salt);
    
    // Create decipher and decrypt (GCM with auth tag)
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    
    return decrypted.toString('utf8');
  }
}

/**
 * Verify that the encryption key is configured.
 * Call this at startup to fail fast if misconfigured.
 */
export function verifyEncryptionConfig(): void {
  if (!process.env.ENCRYPTION_KEY) {
    throw new Error(
      'Missing ENCRYPTION_KEY environment variable. ' +
      'Generate one with: openssl rand -base64 32'
    );
  }
  
  // Test encryption/decryption works
  const testValue = 'encryption-test-' + Date.now();
  const encrypted = encrypt(testValue);
  const decrypted = decrypt(encrypted);
  
  if (decrypted !== testValue) {
    throw new Error('Encryption self-test failed');
  }
}
