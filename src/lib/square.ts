import { SquareClient, SquareEnvironment } from 'square';

/**
 * Determines the Square environment based on NODE_ENV
 */
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Get the appropriate access token based on environment
 */
const getAccessToken = (): string => {
  const token = isProduction
    ? process.env.SQUARE_PRODUCTION_ACCESS_TOKEN
    : process.env.SQUARE_SANDBOX_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      `Missing Square access token. Please set ${
        isProduction ? 'SQUARE_PRODUCTION_ACCESS_TOKEN' : 'SQUARE_SANDBOX_ACCESS_TOKEN'
      } environment variable.`
    );
  }

  return token;
};

/**
 * Square API client instance
 * 
 * Uses sandbox environment for development and production environment for production.
 * Access token is selected based on NODE_ENV.
 */
export const squareClient = new SquareClient({
  token: getAccessToken(),
  environment: isProduction ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
});

/**
 * Helper to handle Square API errors and extract meaningful messages
 */
export function handleSquareError(error: unknown): string {
  if (error instanceof Error) {
    // Check if it's a Square API error with more details
    const squareError = error as Error & { 
      errors?: Array<{ category: string; code: string; detail?: string }> 
    };
    
    if (squareError.errors && squareError.errors.length > 0) {
      return squareError.errors.map(e => e.detail || e.code).join('; ');
    }
    
    return error.message;
  }
  
  return 'An unknown error occurred';
}

/**
 * Re-export commonly used Square types for convenience
 */
export { SquareClient, SquareEnvironment } from 'square';
