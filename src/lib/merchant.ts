import { SquareClient, SquareEnvironment } from 'square';
import { prisma } from './prisma';
import { decrypt } from './encryption';

/**
 * Merchant information with decrypted access token
 */
export interface MerchantConfig {
  merchantId: string;
  accessToken: string;
  isSandbox: boolean;
}

/**
 * Cache for Square clients to avoid recreating them for every request.
 * Key: merchantId, Value: { client, expiresAt }
 */
const clientCache = new Map<string, { client: SquareClient; expiresAt: number }>();

/**
 * Cache TTL in milliseconds (5 minutes)
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Get merchant configuration by merchant ID.
 * 
 * @param merchantId - The unique merchant identifier
 * @returns Merchant configuration with decrypted access token
 * @throws Error if merchant not found or inactive
 */
export async function getMerchantConfig(merchantId: string): Promise<MerchantConfig> {
  const merchant = await prisma.merchant.findUnique({
    where: { merchant_id: merchantId },
  });

  if (!merchant) {
    throw new Error(`Merchant not found: ${merchantId}`);
  }

  if (!merchant.is_active) {
    throw new Error(`Merchant is inactive: ${merchantId}`);
  }

  // Decrypt the access token
  const accessToken = decrypt(merchant.square_access_token_encrypted);

  return {
    merchantId: merchant.merchant_id,
    accessToken,
    isSandbox: merchant.is_sandbox,
  };
}

/**
 * Get a Square client for a specific merchant.
 * 
 * Clients are cached for performance. The cache is checked first,
 * and a new client is created if the cached client has expired.
 * 
 * @param merchantId - The unique merchant identifier
 * @returns Configured Square client for the merchant
 */
export async function getSquareClientForMerchant(merchantId: string): Promise<SquareClient> {
  const now = Date.now();
  
  // Check cache first
  const cached = clientCache.get(merchantId);
  if (cached && cached.expiresAt > now) {
    return cached.client;
  }

  // Get merchant config and create new client
  const config = await getMerchantConfig(merchantId);
  
  const client = new SquareClient({
    token: config.accessToken,
    environment: config.isSandbox ? SquareEnvironment.Sandbox : SquareEnvironment.Production,
  });

  // Cache the client
  clientCache.set(merchantId, {
    client,
    expiresAt: now + CACHE_TTL_MS,
  });

  return client;
}

/**
 * Clear the client cache for a specific merchant.
 * Call this when merchant credentials are updated.
 * 
 * @param merchantId - The merchant ID to clear from cache
 */
export function clearMerchantCache(merchantId: string): void {
  clientCache.delete(merchantId);
}

/**
 * Clear the entire client cache.
 */
export function clearAllMerchantCache(): void {
  clientCache.clear();
}
