import { Hono } from 'hono';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type BookingCreateArgs,
  type BookingGetArgs,
  type BookingUpdateArgs,
  type BookingCancelArgs,
  type BookingListArgs,
  type BookingInfo,
} from '../../types';

const app = new Hono();

/**
 * Generate a unique idempotency key
 */
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Format date/time for TTS (e.g., "Tuesday, January 15 at 2:00 PM")
 */
function formatDateTime(isoDate: string, timezone?: string): string {
  return new Date(isoDate).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
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
 * Transform Square booking to simplified BookingInfo (TTS-optimized)
 */
async function transformBooking(booking: Record<string, unknown>): Promise<BookingInfo> {
  const appointmentSegments = booking.appointmentSegments as Array<Record<string, unknown>> | undefined;
  const startAt = booking.startAt as string;
  const durationMinutes = appointmentSegments?.[0]?.durationMinutes as number | undefined;
  
  // Try to get location name
  let locationName: string | undefined;
  try {
    const locResponse = await squareClient.locations.get({ locationId: booking.locationId as string });
    locationName = (locResponse.location as unknown as Record<string, unknown>)?.name as string;
  } catch {
    // Ignore error
  }

  // Try to get customer name
  let customerName: string | undefined;
  if (booking.customerId) {
    try {
      const custResponse = await squareClient.customers.get({ customerId: booking.customerId as string });
      const customer = custResponse.customer as unknown as Record<string, unknown>;
      customerName = [customer.givenName, customer.familyName].filter(Boolean).join(' ') || undefined;
    } catch {
      // Ignore error
    }
  }

  // Try to get team member name
  let staffName: string | undefined;
  const teamMemberId = appointmentSegments?.[0]?.teamMemberId as string | undefined;
  if (teamMemberId) {
    try {
      const memberResponse = await squareClient.teamMembers.get({ teamMemberId });
      const member = memberResponse.teamMember as unknown as Record<string, unknown>;
      staffName = [member.givenName, member.familyName].filter(Boolean).join(' ') || undefined;
    } catch {
      // Ignore error
    }
  }

  // Try to get service name (get the parent item name, not variation)
  let serviceName: string | undefined;
  const serviceVariationId = appointmentSegments?.[0]?.serviceVariationId as string | undefined;
  if (serviceVariationId) {
    try {
      const catalogResponse = await squareClient.catalog.object.get({ 
        objectId: serviceVariationId,
        includeRelatedObjects: true,
      });
      const variation = catalogResponse.object as unknown as Record<string, unknown>;
      const variationData = variation?.itemVariationData as Record<string, unknown> | undefined;
      const itemId = variationData?.itemId as string | undefined;
      
      // Try to get the parent item name
      if (itemId && catalogResponse.relatedObjects) {
        const parentItem = (catalogResponse.relatedObjects as unknown as Array<Record<string, unknown>>)
          .find((obj) => obj.id === itemId);
        if (parentItem) {
          const itemData = parentItem.itemData as Record<string, unknown> | undefined;
          serviceName = itemData?.name as string | undefined;
        }
      }
      
      // Fallback to variation name
      if (!serviceName) {
        serviceName = variationData?.name as string | undefined;
      }
    } catch {
      // Ignore error
    }
  }

  return {
    booking_id: booking.id as string,
    status: formatStatus(booking.status as string),
    start_at: startAt,
    appointment_time: formatDateTime(startAt),
    duration: durationMinutes ? formatDuration(durationMinutes) : undefined,
    location_name: locationName,
    customer_name: customerName,
    staff_name: staffName,
    service_name: serviceName,
    customer_note: booking.customerNote as string | undefined,
    version: booking.version as number,
  };
}

/**
 * Create a new booking
 */
app.post('/create', async (c) => {
  try {
    const body = await c.req.json();
    const args: BookingCreateArgs = body.arguments || body;

    // Validate required parameters
    if (!args.location_id) {
      return c.json(errorResponse('Missing required parameter: location_id'), 400);
    }
    if (!args.service_variation_id) {
      return c.json(errorResponse('Missing required parameter: service_variation_id'), 400);
    }
    if (!args.start_at) {
      return c.json(errorResponse('Missing required parameter: start_at'), 400);
    }

    // Build appointment segment
    const appointmentSegment: Record<string, unknown> = {
      serviceVariationId: args.service_variation_id,
      serviceVariationVersion: BigInt(Date.now()), // Use current timestamp as version
    };

    if (args.team_member_id) {
      appointmentSegment.teamMemberId = args.team_member_id;
    }

    // Build booking request
    const bookingData: Record<string, unknown> = {
      locationId: args.location_id,
      startAt: args.start_at,
      appointmentSegments: [appointmentSegment],
    };

    if (args.customer_id) {
      bookingData.customerId = args.customer_id;
    }

    if (args.customer_note) {
      bookingData.customerNote = args.customer_note;
    }

    const response = await squareClient.bookings.create({
      idempotencyKey: generateIdempotencyKey(),
      booking: bookingData,
    });

    if (!response.booking) {
      return c.json(errorResponse('Failed to create booking'), 500);
    }

    const booking = await transformBooking(response.booking as unknown as Record<string, unknown>);

    return c.json(successResponse({
      message: 'Booking created successfully',
      booking,
    }));
  } catch (error) {
    console.error('Booking create error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Get booking details
 */
app.post('/get', async (c) => {
  try {
    const body = await c.req.json();
    const args: BookingGetArgs = body.arguments || body;

    if (!args.booking_id) {
      return c.json(errorResponse('Missing required parameter: booking_id'), 400);
    }

    const response = await squareClient.bookings.get({ bookingId: args.booking_id });

    if (!response.booking) {
      return c.json(errorResponse('Booking not found'), 404);
    }

    const booking = await transformBooking(response.booking as unknown as Record<string, unknown>);

    return c.json(successResponse({ booking }));
  } catch (error) {
    console.error('Booking get error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Update an existing booking
 */
app.post('/update', async (c) => {
  try {
    const body = await c.req.json();
    const args: BookingUpdateArgs = body.arguments || body;

    if (!args.booking_id) {
      return c.json(errorResponse('Missing required parameter: booking_id'), 400);
    }
    if (args.booking_version === undefined) {
      return c.json(errorResponse('Missing required parameter: booking_version'), 400);
    }

    // Get the current booking first
    const currentResponse = await squareClient.bookings.get({ bookingId: args.booking_id });
    if (!currentResponse.booking) {
      return c.json(errorResponse('Booking not found'), 404);
    }

    const currentBooking = currentResponse.booking as unknown as Record<string, unknown>;
    const currentSegments = currentBooking.appointmentSegments as Array<Record<string, unknown>> | undefined;

    // Build update data
    const bookingUpdate: Record<string, unknown> = {
      version: args.booking_version,
    };

    if (args.start_at) {
      bookingUpdate.startAt = args.start_at;
    }

    if (args.customer_note !== undefined) {
      bookingUpdate.customerNote = args.customer_note;
    }

    // Handle appointment segment updates
    if (args.team_member_id || args.service_variation_id) {
      const updatedSegment: Record<string, unknown> = {
        ...currentSegments?.[0],
      };
      
      if (args.team_member_id) {
        updatedSegment.teamMemberId = args.team_member_id;
      }
      
      if (args.service_variation_id) {
        updatedSegment.serviceVariationId = args.service_variation_id;
      }
      
      bookingUpdate.appointmentSegments = [updatedSegment];
    }

    const response = await squareClient.bookings.update({
      bookingId: args.booking_id,
      idempotencyKey: generateIdempotencyKey(),
      booking: bookingUpdate,
    });

    if (!response.booking) {
      return c.json(errorResponse('Failed to update booking'), 500);
    }

    const booking = await transformBooking(response.booking as unknown as Record<string, unknown>);

    return c.json(successResponse({
      message: 'Booking updated successfully',
      booking,
    }));
  } catch (error) {
    console.error('Booking update error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Cancel a booking
 */
app.post('/cancel', async (c) => {
  try {
    const body = await c.req.json();
    const args: BookingCancelArgs = body.arguments || body;

    if (!args.booking_id) {
      return c.json(errorResponse('Missing required parameter: booking_id'), 400);
    }

    const response = await squareClient.bookings.cancel({
      bookingId: args.booking_id,
      idempotencyKey: generateIdempotencyKey(),
      bookingVersion: args.booking_version,
    });

    if (!response.booking) {
      return c.json(errorResponse('Failed to cancel booking'), 500);
    }

    const booking = await transformBooking(response.booking as unknown as Record<string, unknown>);

    return c.json(successResponse({
      message: 'Booking cancelled successfully',
      booking,
    }));
  } catch (error) {
    console.error('Booking cancel error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * List bookings with optional filters
 */
app.post('/list', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const args: BookingListArgs = body.arguments || body;

    const listParams: Record<string, unknown> = {};

    if (args.location_id) {
      listParams.locationId = args.location_id;
    }
    if (args.customer_id) {
      listParams.customerId = args.customer_id;
    }
    if (args.team_member_id) {
      listParams.teamMemberId = args.team_member_id;
    }
    if (args.start_at_min) {
      listParams.startAtMin = args.start_at_min;
    }
    if (args.start_at_max) {
      listParams.startAtMax = args.start_at_max;
    }
    if (args.limit) {
      listParams.limit = args.limit;
    }

    const response = await squareClient.bookings.list(listParams);

    const bookings: BookingInfo[] = [];
    for await (const booking of response) {
      const transformed = await transformBooking(booking as unknown as Record<string, unknown>);
      bookings.push(transformed);
      
      // Limit results if specified
      if (args.limit && bookings.length >= args.limit) break;
    }

    // Separate upcoming from past bookings
    const now = new Date();
    const upcoming = bookings.filter((b) => new Date(b.start_at) >= now && b.status !== 'CANCELLED');
    const past = bookings.filter((b) => new Date(b.start_at) < now || b.status === 'CANCELLED');

    return c.json(successResponse({
      total_count: bookings.length,
      upcoming_count: upcoming.length,
      past_count: past.length,
      upcoming,
      past,
    }));
  } catch (error) {
    console.error('Bookings list error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'bookings',
    description: 'Booking/appointment management endpoints for voice agent',
    endpoints: [
      {
        path: '/create',
        method: 'POST',
        description: 'Create a new appointment booking',
        parameters: {
          location_id: { type: 'string', required: true, description: 'Square location ID' },
          service_variation_id: { type: 'string', required: true, description: 'Service variation ID' },
          start_at: { type: 'string', required: true, description: 'Start time (RFC 3339)' },
          customer_id: { type: 'string', required: false, description: 'Customer ID' },
          team_member_id: { type: 'string', required: false, description: 'Team member ID' },
          customer_note: { type: 'string', required: false, description: 'Note for the booking' },
        },
      },
      {
        path: '/get',
        method: 'POST',
        description: 'Get details for a specific booking',
        parameters: {
          booking_id: { type: 'string', required: true, description: 'Square booking ID' },
        },
      },
      {
        path: '/update',
        method: 'POST',
        description: 'Update an existing booking',
        parameters: {
          booking_id: { type: 'string', required: true, description: 'Square booking ID' },
          booking_version: { type: 'number', required: true, description: 'Current version' },
          start_at: { type: 'string', required: false, description: 'New start time' },
          team_member_id: { type: 'string', required: false, description: 'New team member' },
          service_variation_id: { type: 'string', required: false, description: 'New service' },
          customer_note: { type: 'string', required: false, description: 'Updated note' },
        },
      },
      {
        path: '/cancel',
        method: 'POST',
        description: 'Cancel a booking',
        parameters: {
          booking_id: { type: 'string', required: true, description: 'Square booking ID' },
          booking_version: { type: 'number', required: false, description: 'Version (optional)' },
          cancel_reason: { type: 'string', required: false, description: 'Cancellation reason' },
        },
      },
      {
        path: '/list',
        method: 'POST',
        description: 'List bookings with optional filters',
        parameters: {
          location_id: { type: 'string', required: false, description: 'Filter by location' },
          customer_id: { type: 'string', required: false, description: 'Filter by customer' },
          team_member_id: { type: 'string', required: false, description: 'Filter by staff' },
          start_at_min: { type: 'string', required: false, description: 'Start of date range' },
          start_at_max: { type: 'string', required: false, description: 'End of date range' },
          limit: { type: 'number', required: false, description: 'Max results' },
        },
      },
    ],
  });
});

export default app;
