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

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

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
    name: 'Ring Buddy API',
    description: 'Webhook API endpoints for AI voice agent to manage Square appointments',
    version: '1.0.0',
    endpoints: {
      customers: {
        base: '/customers',
        description: 'Customer lookup and management',
        routes: ['/lookup', '/search', '/create', '/bookings'],
      },
      locations: {
        base: '/locations',
        description: 'Business location information',
        routes: ['/list', '/get'],
      },
      services: {
        base: '/services',
        description: 'Bookable service catalog',
        routes: ['/list', '/get'],
      },
      staff: {
        base: '/staff',
        description: 'Team member/staff information',
        routes: ['/list', '/get'],
      },
      availability: {
        base: '/availability',
        description: 'Time slot availability search',
        routes: ['/search'],
      },
      bookings: {
        base: '/bookings',
        description: 'Appointment booking management',
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

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// Error handler
app.onError((err, c) => {
  console.error('Error:', err);
  return c.json({ error: 'Internal server error' }, 500);
});

const port = process.env.PORT || 3000;

console.log(`🚀 Ring Buddy server running on port ${port}`);

export default {
  port,
  fetch: app.fetch,
};
