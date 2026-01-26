import { Hono } from 'hono';
import { successResponse, errorResponse } from '../types';

const app = new Hono();

/**
 * Example webhook function
 * 
 * This serves as a template for creating new webhook functions
 * that can be called by the AI voice agent.
 */
app.post('/', async (c) => {
  try {
    const body = await c.req.json();
    
    // Extract arguments from the webhook payload
    const { message } = body.arguments || body;
    
    if (!message) {
      return c.json(errorResponse('Missing required parameter: message'), 400);
    }

    // Your function logic here
    const result = {
      received: message,
      processed_at: new Date().toISOString(),
      echo: `You said: ${message}`,
    };

    return c.json(successResponse(result));
  } catch (error) {
    console.error('Example function error:', error);
    return c.json(errorResponse('Failed to process request'), 500);
  }
});

/**
 * GET endpoint for testing/debugging
 */
app.get('/', (c) => {
  return c.json({
    name: 'example',
    description: 'Example webhook function template',
    method: 'POST',
    parameters: {
      message: {
        type: 'string',
        required: true,
        description: 'A message to echo back',
      },
    },
  });
});

export default app;
