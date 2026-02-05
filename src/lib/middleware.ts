import type { Context, Next } from 'hono';
import type { SquareClient } from 'square';
import { getSquareClientForMerchant } from './merchant';
import { errorResponse } from '../types';

/**
 * Extended Hono variables that include the Square client
 */
export interface MerchantVariables {
  merchantId: string;
  squareClient: SquareClient;
}

/**
 * Middleware that extracts merchant_id from the request and attaches
 * the corresponding Square client to the context.
 * 
 * The merchant_id can be provided in:
 * 1. Request body as `merchant_id`
 * 2. Request body under `arguments.merchant_id`
 * 3. Query parameter as `merchant_id`
 * 4. Header as `X-Merchant-ID`
 * 
 * The Square client is then available via `c.get('squareClient')`
 */
export async function merchantMiddleware(c: Context, next: Next) {
  let merchantId: string | undefined;

  // Try to get merchant_id from various sources
  // 1. Try request body (for POST requests)
  if (c.req.method === 'POST') {
    try {
      // Clone the request to read the body without consuming it
      const body = await c.req.json();
      merchantId = body.merchant_id || body.arguments?.merchant_id;
      
      // Store the parsed body for later use by route handlers
      c.set('parsedBody', body);
    } catch {
      // Body parsing failed, continue to other sources
    }
  }

  // 2. Try query parameter
  if (!merchantId) {
    merchantId = c.req.query('merchant_id');
  }

  // 3. Try header
  if (!merchantId) {
    merchantId = c.req.header('X-Merchant-ID');
  }

  // Validate merchant_id is present
  if (!merchantId) {
    return c.json(
      errorResponse(
        'Missing required parameter: merchant_id. ' +
        'Provide in request body, query parameter, or X-Merchant-ID header.'
      ),
      400
    );
  }

  try {
    // Get the Square client for this merchant
    const squareClient = await getSquareClientForMerchant(merchantId);
    
    // Store in context for route handlers
    c.set('merchantId', merchantId);
    c.set('squareClient', squareClient);
    
    await next();
  } catch (error) {
    // Handle merchant lookup errors
    const message = error instanceof Error ? error.message : 'Failed to load merchant';
    return c.json(errorResponse(message), 401);
  }
}

/**
 * Helper to get the Square client from context.
 * Use this in route handlers after the merchantMiddleware.
 */
export function getSquareClient(c: Context): SquareClient {
  const client = c.get('squareClient') as SquareClient | undefined;
  if (!client) {
    throw new Error('Square client not found in context. Ensure merchantMiddleware is applied.');
  }
  return client;
}

/**
 * Helper to get the merchant ID from context.
 */
export function getMerchantId(c: Context): string {
  const merchantId = c.get('merchantId') as string | undefined;
  if (!merchantId) {
    throw new Error('Merchant ID not found in context. Ensure merchantMiddleware is applied.');
  }
  return merchantId;
}

/**
 * Helper to get the pre-parsed request body from context.
 * The body is parsed by the middleware to extract merchant_id.
 * 
 * @returns The parsed body, or an empty object if not available
 */
export function getParsedBody<T extends Record<string, unknown> = Record<string, unknown>>(c: Context): T {
  return (c.get('parsedBody') as T) || ({} as T);
}

/**
 * Helper to extract arguments from the parsed body.
 * Handles both direct arguments and nested under 'arguments' key.
 */
export function getRequestArgs<T>(c: Context): Partial<T> {
  const body = getParsedBody(c);
  return (body.arguments || body) as Partial<T>;
}
