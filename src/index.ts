import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';

// Import all API routes
import example from './functions/api';
import customers from './functions/customers/api';
import locations from './functions/locations/api';
import services from './functions/services/api';
import staff from './functions/staff/api';
import availability from './functions/availability/api';
import bookings from './functions/bookings/api';
import webhooks from './functions/webhooks/api';
import voice from './functions/voice/api';

// Import merchant middleware
import { merchantMiddleware } from './lib/middleware';

const app = new Hono();

// Global Middleware
app.use('*', logger());
app.use('*', cors());

// Apply merchant middleware to all API routes (except health check and root)
// This extracts merchant_id and attaches the Square client to context
app.use('/customers/*', merchantMiddleware);
app.use('/locations/*', merchantMiddleware);
app.use('/services/*', merchantMiddleware);
app.use('/staff/*', merchantMiddleware);
app.use('/availability/*', merchantMiddleware);
app.use('/bookings/*', merchantMiddleware);
app.use('/voice/*', merchantMiddleware);

// Health check endpoint
app.get('/health', (c) => {
  return c.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
});

// API documentation endpoint
app.get('/', (c) => {
  return c.json({
    name: 'HaloCall API',
    description: 'Webhook API endpoints for AI voice agent to manage Square appointments',
    version: '2.0.0',
    authentication: {
      description: 'All API endpoints require a merchant_id to identify which Square seller account to use.',
      methods: [
        'Request body: { "merchant_id": "your-merchant-id", ... }',
        'Query parameter: ?merchant_id=your-merchant-id',
        'Header: X-Merchant-ID: your-merchant-id',
      ],
    },
    endpoints: {
      voice: {
        base: '/voice',
        description: 'Voice agent endpoints with name-based parameters (recommended for AI agents)',
        routes: ['/services', '/staff', '/locations', '/availability', '/book', '/customer', '/customer/create', '/appointments', '/reschedule', '/cancel'],
      },
      customers: {
        base: '/customers',
        description: 'Customer lookup and management (ID-based)',
        routes: ['/lookup', '/search', '/create', '/bookings'],
      },
      locations: {
        base: '/locations',
        description: 'Business location information (ID-based)',
        routes: ['/list', '/get'],
      },
      services: {
        base: '/services',
        description: 'Bookable service catalog (ID-based)',
        routes: ['/list', '/get'],
      },
      staff: {
        base: '/staff',
        description: 'Team member/staff information (ID-based)',
        routes: ['/list', '/get'],
      },
      availability: {
        base: '/availability',
        description: 'Time slot availability search (ID-based)',
        routes: ['/search'],
      },
      bookings: {
        base: '/bookings',
        description: 'Appointment booking management (ID-based)',
        routes: ['/create', '/get', '/update', '/cancel', '/list'],
      },
    },
  });
});

// Register function routes
app.route('/example', example);
app.route('/customers', customers);
app.route('/locations', locations);
app.route('/services', services);
app.route('/staff', staff);
app.route('/availability', availability);
app.route('/bookings', bookings);
app.route('/webhooks', webhooks);
app.route('/voice', voice);

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = Number(process.env.PORT) || 3000;

console.log(`🚀 HaloCall server starting on 0.0.0.0:${port}`);

// Use Bun's automatic server startup via default export
// hostname: '0.0.0.0' is required for Railway to accept external connections
export default {
  port,
  hostname: '0.0.0.0',
  fetch: app.fetch,
};
