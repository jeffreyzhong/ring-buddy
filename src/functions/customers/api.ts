import { Hono } from 'hono';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type CustomerLookupArgs,
  type CustomerSearchArgs,
  type CustomerCreateArgs,
  type CustomerBookingsArgs,
  type CustomerInfo,
  type BookingInfo,
} from '../../types';

const app = new Hono();

/**
 * Format phone number to E.164 format for Square API
 */
function formatPhoneNumber(phone: string): string {
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // If it's a 10-digit US number, add +1
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  
  // If it starts with 1 and is 11 digits, add +
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  
  // If already has country code, just ensure + prefix
  if (digits.length > 10) {
    return `+${digits}`;
  }
  
  return phone;
}

/**
 * Format date/time for TTS (e.g., "Tuesday, January 15 at 2:00 PM")
 */
function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format duration for TTS (e.g., "1 hour" or "45 minutes")
 */
function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    if (remainingMinutes > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minutes`;
    }
    return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return `${minutes} minutes`;
}

/**
 * Format booking status for TTS (e.g., "confirmed" instead of "ACCEPTED")
 */
function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'PENDING': 'pending',
    'ACCEPTED': 'confirmed',
    'CANCELLED': 'cancelled',
    'CANCELLED_BY_SELLER': 'cancelled',
    'CANCELLED_BY_CUSTOMER': 'cancelled',
    'DECLINED': 'declined',
    'NO_SHOW': 'no show',
  };
  return statusMap[status] || status.toLowerCase();
}

/**
 * Transform Square customer to simplified CustomerInfo (TTS-optimized)
 */
function transformCustomer(customer: Record<string, unknown>): CustomerInfo {
  const givenName = customer.givenName as string | undefined;
  const familyName = customer.familyName as string | undefined;
  const fullName = [givenName, familyName].filter(Boolean).join(' ') || 'Unknown';
  
  return {
    customer_id: customer.id as string,
    name: fullName,
    email: customer.emailAddress as string | undefined,
    phone_number: customer.phoneNumber as string | undefined,
    note: customer.note as string | undefined,
  };
}

/**
 * Lookup customer by phone number
 * 
 * Used when a call comes in to identify the caller by their phone number.
 */
app.post('/lookup', async (c) => {
  try {
    const body = await c.req.json();
    const args: CustomerLookupArgs = body.arguments || body;

    if (!args.phone_number) {
      return c.json(errorResponse('Missing required parameter: phone_number'), 400);
    }

    const formattedPhone = formatPhoneNumber(args.phone_number);

    const response = await squareClient.customers.search({
      query: {
        filter: {
          phoneNumber: {
            exact: formattedPhone,
          },
        },
      },
      limit: BigInt(1),
    });

    const customers = response.customers || [];
    
    if (customers.length === 0) {
      return c.json(successResponse({
        found: false,
        message: 'No customer found with this phone number',
        customer: null,
      }));
    }

    const customer = transformCustomer(customers[0] as unknown as Record<string, unknown>);
    
    return c.json(successResponse({
      found: true,
      customer,
    }));
  } catch (error) {
    console.error('Customer lookup error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Search for customers by various criteria
 */
app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const args: CustomerSearchArgs = body.arguments || body;

    if (!args.phone_number && !args.email && !args.name) {
      return c.json(
        errorResponse('At least one search parameter required: phone_number, email, or name'),
        400
      );
    }

    // Build filter based on provided parameters
    const filter: Record<string, unknown> = {};

    if (args.phone_number) {
      filter.phoneNumber = {
        fuzzy: formatPhoneNumber(args.phone_number),
      };
    }

    if (args.email) {
      filter.emailAddress = {
        fuzzy: args.email,
      };
    }

    const response = await squareClient.customers.search({
      query: {
        filter,
      },
      limit: args.limit ? BigInt(Math.min(args.limit, 100)) : undefined,
    });

    const customers = (response.customers || []).map((cust) =>
      transformCustomer(cust as unknown as Record<string, unknown>)
    );

    // If searching by name, filter client-side (Square doesn't have direct name filter)
    let filteredCustomers = customers;
    if (args.name) {
      const searchName = args.name.toLowerCase();
      filteredCustomers = customers.filter((cust) => {
        const fullName = (cust.name || '').toLowerCase();
        return fullName.includes(searchName);
      });
    }

    return c.json(successResponse({
      count: filteredCustomers.length,
      customers: filteredCustomers,
    }));
  } catch (error) {
    console.error('Customer search error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Create a new customer
 */
app.post('/create', async (c) => {
  try {
    const body = await c.req.json();
    const args: CustomerCreateArgs = body.arguments || body;

    if (!args.given_name && !args.phone_number && !args.email) {
      return c.json(
        errorResponse('At least one of given_name, phone_number, or email is required'),
        400
      );
    }

    const customerData: Record<string, unknown> = {};
    
    if (args.given_name) customerData.givenName = args.given_name;
    if (args.family_name) customerData.familyName = args.family_name;
    if (args.email) customerData.emailAddress = args.email;
    if (args.phone_number) customerData.phoneNumber = formatPhoneNumber(args.phone_number);
    if (args.note) customerData.note = args.note;

    const response = await squareClient.customers.create(customerData);

    if (!response.customer) {
      return c.json(errorResponse('Failed to create customer'), 500);
    }

    const customer = transformCustomer(response.customer as unknown as Record<string, unknown>);

    return c.json(successResponse({
      message: 'Customer created successfully',
      customer,
    }));
  } catch (error) {
    console.error('Customer create error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Get all bookings for a customer
 */
app.post('/bookings', async (c) => {
  try {
    const body = await c.req.json();
    const args: CustomerBookingsArgs = body.arguments || body;

    if (!args.customer_id) {
      return c.json(errorResponse('Missing required parameter: customer_id'), 400);
    }

    const params: Record<string, unknown> = {
      customerId: args.customer_id,
    };
    
    if (args.location_id) {
      params.locationId = args.location_id;
    }
    
    if (args.limit) {
      params.limit = args.limit;
    }

    const response = await squareClient.bookings.list(params);

    const bookings: BookingInfo[] = [];
    for await (const booking of response) {
      const b = booking as unknown as Record<string, unknown>;
      const startAt = b.startAt as string;
      const appointmentSegments = b.appointmentSegments as Array<Record<string, unknown>> | undefined;
      const durationMinutes = appointmentSegments?.[0]?.durationMinutes as number | undefined;
      const status = b.status as string;
      
      bookings.push({
        booking_id: b.id as string,
        status: formatStatus(status),
        start_at: startAt,
        appointment_time: formatDateTime(startAt),
        duration: durationMinutes ? formatDuration(durationMinutes) : undefined,
        customer_note: b.customerNote as string | undefined,
        version: b.version as number,
      });
      
      // Limit results if specified
      if (args.limit && bookings.length >= args.limit) break;
    }

    return c.json(successResponse({
      count: bookings.length,
      bookings,
    }));
  } catch (error) {
    console.error('Customer bookings error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'customers',
    description: 'Customer management endpoints for voice agent',
    endpoints: [
      {
        path: '/lookup',
        method: 'POST',
        description: 'Find customer by phone number (caller ID lookup)',
        parameters: {
          phone_number: { type: 'string', required: true, description: 'Phone number to look up' },
        },
      },
      {
        path: '/search',
        method: 'POST',
        description: 'Search customers by various criteria',
        parameters: {
          phone_number: { type: 'string', required: false, description: 'Search by phone' },
          email: { type: 'string', required: false, description: 'Search by email' },
          name: { type: 'string', required: false, description: 'Search by name' },
          limit: { type: 'number', required: false, description: 'Max results (1-100)' },
        },
      },
      {
        path: '/create',
        method: 'POST',
        description: 'Create a new customer profile',
        parameters: {
          given_name: { type: 'string', required: false, description: 'First name' },
          family_name: { type: 'string', required: false, description: 'Last name' },
          email: { type: 'string', required: false, description: 'Email address' },
          phone_number: { type: 'string', required: false, description: 'Phone number' },
          note: { type: 'string', required: false, description: 'Note about customer' },
        },
      },
      {
        path: '/bookings',
        method: 'POST',
        description: 'Get all bookings for a customer',
        parameters: {
          customer_id: { type: 'string', required: true, description: 'Square customer ID' },
          location_id: { type: 'string', required: false, description: 'Filter by location' },
          limit: { type: 'number', required: false, description: 'Max results to return' },
        },
      },
    ],
  });
});

export default app;
