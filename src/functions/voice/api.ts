/**
 * Voice Agent Endpoints
 * 
 * Name-based API endpoints optimized for AI voice agents.
 * These endpoints accept human-readable names and natural language dates,
 * with the backend resolving them to Square IDs.
 */

import { Hono } from 'hono';
import type { SegmentFilter } from 'square';
import { handleSquareError } from '../../lib/square';
import { getSquareClient, getRequestArgs } from '../../lib/middleware';
import { successResponse, errorResponse } from '../../types';
import {
  resolveServiceName,
  resolveStaffName,
  resolveLocationName,
  listServices,
  listStaff,
  listLocations,
  getLocation,
  getServiceDisplayName,
} from '../../lib/name-resolver';
import {
  parseNaturalDateTime,
  parseBookingTime,
  formatForVoice,
} from '../../lib/date-parser';
import type {
  VoiceServicesArgs,
  VoiceStaffArgs,
  VoiceLocationsArgs,
  VoiceAvailabilityArgs,
  VoiceBookArgs,
  VoiceCustomerLookupArgs,
  VoiceCustomerCreateArgs,
  VoiceAppointmentsArgs,
  VoiceRescheduleArgs,
  VoiceCancelArgs,
} from '../../types/voice';

const app = new Hono();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format phone number to E.164 format
 */
function formatPhoneNumber(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return phone;
}

/**
 * Generate idempotency key for Square API calls
 */
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * Format booking status for TTS
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
 * Format duration for TTS
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

// ============================================================================
// Endpoint 1: List Services
// ============================================================================

/**
 * POST /voice/services
 * List all available services with names, durations, and prices
 */
app.post('/services', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const _args = getRequestArgs<VoiceServicesArgs>(c);

    const services = await listServices(squareClient);

    const formattedServices = services.map(s => ({
      name: getServiceDisplayName(s),
      duration: s.duration,
      price: s.price,
      description: s.description,
    }));

    return c.json(successResponse({
      count: formattedServices.length,
      services: formattedServices,
    }));
  } catch (error) {
    console.error('Voice services error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 2: List Staff
// ============================================================================

/**
 * POST /voice/staff
 * List bookable staff members
 */
app.post('/staff', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceStaffArgs>(c);

    // Resolve location if provided
    let locationId: string | undefined;
    if (args.location_name) {
      const locationResult = await resolveLocationName(squareClient, args.location_name);
      if (locationResult.match) {
        locationId = locationResult.match.location_id;
      }
    }

    const staff = await listStaff(squareClient, locationId);

    return c.json(successResponse({
      count: staff.length,
      staff: staff.map(s => ({ name: s.name })),
    }));
  } catch (error) {
    console.error('Voice staff error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 3: List Locations
// ============================================================================

/**
 * POST /voice/locations
 * List all business locations
 */
app.post('/locations', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const _args = getRequestArgs<VoiceLocationsArgs>(c);

    const locations = await listLocations(squareClient);

    return c.json(successResponse({
      count: locations.length,
      locations: locations.map(l => ({
        name: l.name,
        address: l.address,
        phone: l.phone_number,
      })),
    }));
  } catch (error) {
    console.error('Voice locations error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 4: Check Availability
// ============================================================================

/**
 * POST /voice/availability
 * Find available appointment times using natural language
 */
app.post('/availability', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceAvailabilityArgs>(c);

    // Validate required parameters
    if (!args.service_name) {
      return c.json(errorResponse('Please specify which service you would like to book.'), 400);
    }
    if (!args.date_preference) {
      return c.json(errorResponse('Please specify when you would like to book (e.g., "tomorrow", "next Tuesday").'), 400);
    }

    // 1. Resolve location
    const locations = await listLocations(squareClient);
    let locationId: string;
    let locationName: string;

    if (locations.length === 0) {
      return c.json(errorResponse('No locations are currently available for booking.'), 404);
    } else if (locations.length === 1) {
      locationId = locations[0].location_id;
      locationName = locations[0].name;
    } else if (args.location_name) {
      const locationResult = await resolveLocationName(squareClient, args.location_name);
      if (locationResult.confidence === 'none') {
        return c.json(errorResponse(
          `I couldn't find a location called "${args.location_name}". Available locations are: ${locations.map(l => l.name).join(', ')}.`
        ), 404);
      }
      if (locationResult.confidence === 'ambiguous') {
        return c.json(errorResponse(
          `Multiple locations match. Please specify: ${locationResult.alternatives!.map(l => l.name).join(', ')}.`
        ), 400);
      }
      locationId = locationResult.match!.location_id;
      locationName = locationResult.match!.name;
    } else {
      return c.json(errorResponse(
        `We have multiple locations. Which would you prefer: ${locations.map(l => l.name).join(', ')}?`
      ), 400);
    }

    // 2. Resolve service name
    const serviceResult = await resolveServiceName(squareClient, args.service_name, locationId);
    if (serviceResult.confidence === 'none') {
      const services = await listServices(squareClient);
      const serviceNames = [...new Set(services.map(s => s.service_name))].slice(0, 5);
      return c.json(errorResponse(
        `I couldn't find a service called "${args.service_name}". Available services include: ${serviceNames.join(', ')}.`
      ), 404);
    }
    if (serviceResult.confidence === 'ambiguous') {
      const options = serviceResult.alternatives!.map(s => getServiceDisplayName(s));
      return c.json(errorResponse(
        `Multiple services match. Please specify: ${options.join(', ')}.`
      ), 400);
    }
    const service = serviceResult.match!;

    // 3. Resolve staff (optional)
    let staffMemberIds: string[] | undefined;
    let staffName: string | undefined;
    if (args.staff_name && args.staff_name.toLowerCase() !== 'anyone' && args.staff_name.toLowerCase() !== 'any') {
      const staffResult = await resolveStaffName(squareClient, args.staff_name, locationId);
      if (staffResult.confidence === 'none') {
        const staff = await listStaff(squareClient, locationId);
        return c.json(errorResponse(
          `I couldn't find a staff member named "${args.staff_name}". Available staff: ${staff.map(s => s.name).join(', ')}.`
        ), 404);
      }
      if (staffResult.confidence === 'ambiguous') {
        return c.json(errorResponse(
          `Multiple staff match. Please specify: ${staffResult.alternatives!.map(s => s.name).join(', ')}.`
        ), 400);
      }
      staffMemberIds = [staffResult.match!.team_member_id];
      staffName = staffResult.match!.name;
    }

    // 4. Parse date preference
    const location = await getLocation(squareClient, locationId);
    const dateRange = parseNaturalDateTime(args.date_preference, {
      timezone: location.timezone,
    });

    // 5. Build segment filter
    const segmentFilter: SegmentFilter = {
      serviceVariationId: service.variation_id,
    };
    if (staffMemberIds && staffMemberIds.length > 0) {
      segmentFilter.teamMemberIdFilter = { any: staffMemberIds };
    }

    // 6. Search availability
    const response = await squareClient.bookings.searchAvailability({
      query: {
        filter: {
          startAtRange: {
            startAt: dateRange.rangeStart,
            endAt: dateRange.rangeEnd,
          },
          locationId,
          segmentFilters: [segmentFilter],
        },
      },
    });

    const availabilities = response.availabilities || [];

    // 7. Group by date for voice output
    const slotsByDate: Record<string, string[]> = {};
    for (const avail of availabilities) {
      const a = avail as unknown as Record<string, unknown>;
      const startAt = a.startAt as string;
      
      const date = new Date(startAt).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: location.timezone,
      });
      
      const time = new Date(startAt).toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: location.timezone,
      });
      
      if (!slotsByDate[date]) {
        slotsByDate[date] = [];
      }
      slotsByDate[date].push(time);
    }

    // 8. Generate summary
    const totalSlots = availabilities.length;
    const dateCount = Object.keys(slotsByDate).length;
    let summary: string;
    
    if (totalSlots === 0) {
      summary = `I don't see any openings for ${getServiceDisplayName(service)} ${dateRange.humanReadable}. Would you like me to check a different time?`;
    } else if (dateCount === 1) {
      const date = Object.keys(slotsByDate)[0];
      const times = slotsByDate[date];
      summary = `I found ${times.length} opening${times.length > 1 ? 's' : ''} on ${date}: ${times.slice(0, 3).join(', ')}${times.length > 3 ? ` and ${times.length - 3} more` : ''}.`;
    } else {
      summary = `I found ${totalSlots} openings across ${dateCount} days. `;
      const firstDate = Object.keys(slotsByDate)[0];
      summary += `On ${firstDate}, I have ${slotsByDate[firstDate].slice(0, 3).join(', ')}.`;
    }

    return c.json(successResponse({
      availability: slotsByDate,
      service_name: getServiceDisplayName(service),
      location_name: locationName,
      staff_name: staffName,
      summary,
    }));
  } catch (error) {
    console.error('Voice availability error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 5: Book Appointment
// ============================================================================

/**
 * POST /voice/book
 * Create a new appointment booking using natural language
 */
app.post('/book', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceBookArgs>(c);

    // Validate required parameters
    if (!args.service_name) {
      return c.json(errorResponse('Please specify which service you would like to book.'), 400);
    }
    if (!args.time) {
      return c.json(errorResponse('Please specify when you would like to book (e.g., "tomorrow at 2pm").'), 400);
    }

    // 1. Resolve location
    const locations = await listLocations(squareClient);
    let locationId: string;
    let locationName: string;

    if (locations.length === 0) {
      return c.json(errorResponse('No locations are currently available for booking.'), 404);
    } else if (locations.length === 1) {
      locationId = locations[0].location_id;
      locationName = locations[0].name;
    } else if (args.location_name) {
      const locationResult = await resolveLocationName(squareClient, args.location_name);
      if (locationResult.confidence === 'none' || !locationResult.match) {
        return c.json(errorResponse(
          `I couldn't find a location called "${args.location_name}". Please specify: ${locations.map(l => l.name).join(', ')}.`
        ), 404);
      }
      locationId = locationResult.match.location_id;
      locationName = locationResult.match.name;
    } else {
      return c.json(errorResponse(
        `We have multiple locations. Which would you prefer: ${locations.map(l => l.name).join(', ')}?`
      ), 400);
    }

    // 2. Resolve service name
    const serviceResult = await resolveServiceName(squareClient, args.service_name, locationId);
    if (serviceResult.confidence === 'none' || !serviceResult.match) {
      return c.json(errorResponse(`I couldn't find a service called "${args.service_name}".`), 404);
    }
    if (serviceResult.confidence === 'ambiguous') {
      const options = serviceResult.alternatives!.map(s => getServiceDisplayName(s));
      return c.json(errorResponse(`Multiple services match. Please specify: ${options.join(', ')}.`), 400);
    }
    const service = serviceResult.match;

    // 3. Resolve staff (optional)
    let teamMemberId: string | undefined;
    let staffName: string | undefined;
    if (args.staff_name && args.staff_name.toLowerCase() !== 'anyone' && args.staff_name.toLowerCase() !== 'any') {
      const staffResult = await resolveStaffName(squareClient, args.staff_name, locationId);
      if (staffResult.match) {
        teamMemberId = staffResult.match.team_member_id;
        staffName = staffResult.match.name;
      }
    }

    // 4. Parse booking time
    const location = await getLocation(squareClient, locationId);
    const startAt = parseBookingTime(args.time, { timezone: location.timezone });
    
    if (!startAt) {
      return c.json(errorResponse(
        `I need a specific time to book. Could you please say something like "tomorrow at 2pm" or "Thursday at 10:30am"?`
      ), 400);
    }

    // 5. Build booking request
    const appointmentSegment: Record<string, unknown> = {
      serviceVariationId: service.variation_id,
      serviceVariationVersion: BigInt(Date.now()),
    };
    if (teamMemberId) {
      appointmentSegment.teamMemberId = teamMemberId;
    }

    const bookingData: Record<string, unknown> = {
      locationId,
      startAt,
      appointmentSegments: [appointmentSegment],
    };

    // Add customer if provided
    if (args.customer_id) {
      bookingData.customerId = args.customer_id;
    }

    // Add notes if provided
    if (args.notes) {
      bookingData.customerNote = args.notes;
    }

    // 6. Create booking
    const response = await squareClient.bookings.create({
      idempotencyKey: generateIdempotencyKey(),
      booking: bookingData,
    });

    if (!response.booking) {
      return c.json(errorResponse('Failed to create the booking. Please try again.'), 500);
    }

    const booking = response.booking as unknown as Record<string, unknown>;
    const appointmentSegments = booking.appointmentSegments as Array<Record<string, unknown>> | undefined;
    const durationMinutes = appointmentSegments?.[0]?.durationMinutes as number | undefined;

    // 7. Build confirmation response
    const appointmentTime = formatForVoice(booking.startAt as string, location.timezone);
    const summary = `Great! I've booked your ${getServiceDisplayName(service)} for ${appointmentTime} at ${locationName}${staffName ? ` with ${staffName}` : ''}. Your confirmation number is ${(booking.id as string).slice(-6)}.`;

    return c.json(successResponse({
      confirmation_id: booking.id as string,
      appointment_time: appointmentTime,
      service_name: getServiceDisplayName(service),
      location_name: locationName,
      staff_name: staffName,
      duration: durationMinutes ? formatDuration(durationMinutes) : service.duration,
      summary,
    }));
  } catch (error) {
    console.error('Voice book error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 6: Customer Lookup
// ============================================================================

/**
 * POST /voice/customer
 * Look up a customer by phone number
 */
app.post('/customer', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceCustomerLookupArgs>(c);

    if (!args.phone) {
      return c.json(errorResponse('Please provide a phone number.'), 400);
    }

    const formattedPhone = formatPhoneNumber(args.phone);

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
        message: 'I don\'t have a record for this phone number. Would you like me to create a new customer profile?',
      }));
    }

    const customer = customers[0] as unknown as Record<string, unknown>;
    const givenName = customer.givenName as string | undefined;
    const familyName = customer.familyName as string | undefined;
    const name = [givenName, familyName].filter(Boolean).join(' ') || 'Customer';

    return c.json(successResponse({
      found: true,
      name,
      customer_id: customer.id as string,
      message: `Welcome back, ${givenName || name}!`,
    }));
  } catch (error) {
    console.error('Voice customer lookup error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 7: Create Customer
// ============================================================================

/**
 * POST /voice/customer/create
 * Create a new customer profile
 */
app.post('/customer/create', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceCustomerCreateArgs>(c);

    if (!args.first_name) {
      return c.json(errorResponse('Please provide your first name.'), 400);
    }
    if (!args.phone) {
      return c.json(errorResponse('Please provide a phone number.'), 400);
    }

    const customerData: Record<string, unknown> = {
      givenName: args.first_name,
      phoneNumber: formatPhoneNumber(args.phone),
    };

    if (args.last_name) {
      customerData.familyName = args.last_name;
    }
    if (args.email) {
      customerData.emailAddress = args.email;
    }

    const response = await squareClient.customers.create(customerData);

    if (!response.customer) {
      return c.json(errorResponse('Failed to create customer profile.'), 500);
    }

    const customer = response.customer as unknown as Record<string, unknown>;

    return c.json(successResponse({
      found: true,
      name: args.first_name + (args.last_name ? ` ${args.last_name}` : ''),
      customer_id: customer.id as string,
      message: `I've created your profile, ${args.first_name}. You're all set to book an appointment!`,
    }));
  } catch (error) {
    console.error('Voice customer create error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 8: Get Customer Appointments
// ============================================================================

/**
 * POST /voice/appointments
 * Get a customer's upcoming appointments
 */
app.post('/appointments', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceAppointmentsArgs>(c);

    if (!args.phone) {
      return c.json(errorResponse('Please provide your phone number so I can look up your appointments.'), 400);
    }

    // First, find the customer
    const formattedPhone = formatPhoneNumber(args.phone);
    const customerResponse = await squareClient.customers.search({
      query: {
        filter: {
          phoneNumber: { exact: formattedPhone },
        },
      },
      limit: BigInt(1),
    });

    const customers = customerResponse.customers || [];
    if (customers.length === 0) {
      return c.json(successResponse({
        customer_name: 'Unknown',
        upcoming_count: 0,
        upcoming: [],
        summary: 'I don\'t have any records for this phone number.',
      }));
    }

    const customer = customers[0] as unknown as Record<string, unknown>;
    const customerId = customer.id as string;
    const givenName = customer.givenName as string | undefined;
    const customerName = givenName || 'Customer';

    // Get bookings for this customer
    const bookingsResponse = await squareClient.bookings.list({
      customerId,
    });

    const now = new Date();
    const upcoming: Array<{
      booking_id: string;
      appointment_time: string;
      service_name?: string;
      location_name?: string;
      staff_name?: string;
      status: string;
      version: number;
    }> = [];

    for await (const booking of bookingsResponse) {
      const b = booking as unknown as Record<string, unknown>;
      const startAt = b.startAt as string;
      const bookingDate = new Date(startAt);
      const status = b.status as string;

      // Only include upcoming, non-cancelled bookings
      if (bookingDate >= now && !status.includes('CANCELLED')) {
        const appointmentSegments = b.appointmentSegments as Array<Record<string, unknown>> | undefined;
        
        upcoming.push({
          booking_id: b.id as string,
          appointment_time: formatForVoice(startAt),
          status: formatStatus(status),
          version: b.version as number,
        });
      }

      if (upcoming.length >= 5) break;
    }

    // Sort by date
    upcoming.sort((a, b) => new Date(a.appointment_time).getTime() - new Date(b.appointment_time).getTime());

    // Generate summary
    let summary: string;
    if (upcoming.length === 0) {
      summary = `${customerName}, you don't have any upcoming appointments. Would you like to book one?`;
    } else if (upcoming.length === 1) {
      summary = `${customerName}, you have one upcoming appointment on ${upcoming[0].appointment_time}.`;
    } else {
      summary = `${customerName}, you have ${upcoming.length} upcoming appointments. The next one is on ${upcoming[0].appointment_time}.`;
    }

    return c.json(successResponse({
      customer_name: customerName,
      upcoming_count: upcoming.length,
      upcoming,
      summary,
    }));
  } catch (error) {
    console.error('Voice appointments error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 9: Reschedule Appointment
// ============================================================================

/**
 * POST /voice/reschedule
 * Reschedule an existing appointment
 */
app.post('/reschedule', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceRescheduleArgs>(c);

    if (!args.current_appointment) {
      return c.json(errorResponse('Please describe which appointment you want to reschedule.'), 400);
    }
    if (!args.new_time) {
      return c.json(errorResponse('Please specify the new time you would like.'), 400);
    }

    // This is a simplified implementation - in production, you'd need to:
    // 1. Parse the current_appointment description to find the booking
    // 2. Get the current booking version
    // 3. Parse the new_time
    // 4. Update the booking

    // For now, return a helpful message about the capability
    return c.json(errorResponse(
      'To reschedule, please provide your phone number so I can look up your appointments.'
    ), 400);
  } catch (error) {
    console.error('Voice reschedule error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Endpoint 10: Cancel Appointment
// ============================================================================

/**
 * POST /voice/cancel
 * Cancel an existing appointment
 */
app.post('/cancel', async (c) => {
  try {
    const squareClient = getSquareClient(c);
    const args = getRequestArgs<VoiceCancelArgs>(c);

    if (!args.appointment) {
      return c.json(errorResponse('Please describe which appointment you want to cancel.'), 400);
    }

    // Similar to reschedule - simplified implementation
    return c.json(errorResponse(
      'To cancel an appointment, please provide your phone number so I can look up your bookings.'
    ), 400);
  } catch (error) {
    console.error('Voice cancel error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

// ============================================================================
// Documentation Endpoint
// ============================================================================

app.get('/', (c) => {
  return c.json({
    name: 'voice',
    description: 'Voice agent endpoints with name-based parameters',
    note: 'These endpoints accept human-readable names and natural language dates instead of Square IDs.',
    endpoints: [
      { path: '/services', method: 'POST', description: 'List available services' },
      { path: '/staff', method: 'POST', description: 'List staff members' },
      { path: '/locations', method: 'POST', description: 'List locations' },
      { path: '/availability', method: 'POST', description: 'Check available times' },
      { path: '/book', method: 'POST', description: 'Create a booking' },
      { path: '/customer', method: 'POST', description: 'Look up customer by phone' },
      { path: '/customer/create', method: 'POST', description: 'Create new customer' },
      { path: '/appointments', method: 'POST', description: 'Get customer appointments' },
      { path: '/reschedule', method: 'POST', description: 'Reschedule appointment' },
      { path: '/cancel', method: 'POST', description: 'Cancel appointment' },
    ],
  });
});

export default app;
