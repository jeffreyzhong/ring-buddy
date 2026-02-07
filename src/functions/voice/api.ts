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
import { getSquareClient, getMerchantId, getRequestArgs } from '../../lib/middleware';
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
 * Describe a slot count in natural, conversational language
 */
function describeCount(n: number): string {
  if (n === 1) return 'one opening';
  if (n === 2) return 'a couple of openings';
  if (n <= 4) return 'a few openings';
  if (n <= 8) return 'several openings';
  return 'quite a few openings';
}

/**
 * Join a list of names with natural grammar (Oxford comma)
 */
function joinNames(names: string[]): string {
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
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

/**
 * Build a natural, conversational availability summary for the voice agent.
 *
 * Covers 8 distinct result shapes so the output always sounds human.
 */
function buildAvailabilitySummary(
  totalSlots: number,
  slotsByDate: Record<string, { time: string; staff: string[] }[]>,
  allStaffNames: string[],
  serviceName: string,
  humanReadableDateRange: string,
): string {
  const allDates = Object.keys(slotsByDate);
  const dateCount = allDates.length;

  // Case 1 — No results
  if (totalSlots === 0) {
    return `I don't have any openings for ${serviceName} ${humanReadableDateRange}. Would you like me to check a different day?`;
  }

  const firstDate = allDates[0];
  const firstSlots = slotsByDate[firstDate];
  const staffCount = allStaffNames.length;

  if (dateCount === 1) {
    if (staffCount === 1) {
      const staff = allStaffNames[0];

      if (firstSlots.length === 1) {
        // Case 2 — Single date, single staff, 1 slot
        return `${staff} has one opening on ${firstDate} at ${firstSlots[0].time}. Would that work for you?`;
      }

      if (firstSlots.length <= 3) {
        // Case 3 — Single date, single staff, 2-3 slots
        const times = joinNames(firstSlots.map(s => s.time));
        return `${staff} has ${describeCount(firstSlots.length)} on ${firstDate} — ${times}. What time works best?`;
      }

      // Case 4 — Single date, single staff, 4+ slots
      return `${staff} has ${describeCount(firstSlots.length)} on ${firstDate}, starting at ${firstSlots[0].time}. What time works best for you?`;
    }

    // Multiple staff on a single date
    const staffList = staffCount === 2
      ? `both ${allStaffNames[0]} and ${allStaffNames[1]}`
      : joinNames(allStaffNames);

    if (firstSlots.length <= 3) {
      // Case 5 — Single date, multiple staff, few total slots (1-3)
      const slotDescriptions = firstSlots.map(s =>
        `${joinNames(s.staff)} at ${s.time}`
      );
      const prompt = firstSlots.length === 2
        ? 'Would either of those work?'
        : 'Would any of those work?';
      return `I have ${describeCount(firstSlots.length)} on ${firstDate} — ${joinNames(slotDescriptions)}. ${prompt}`;
    }

    // Case 6 — Single date, multiple staff, many total slots (4+)
    const firstSlot = firstSlots[0];
    return `I have ${describeCount(firstSlots.length)} on ${firstDate} with ${staffList}. The earliest is ${firstSlot.time} with ${joinNames(firstSlot.staff)}. What time works best?`;
  }

  // Multiple dates
  const firstSlot = firstSlots[0];
  const withStaff = `with ${joinNames(firstSlot.staff)}`;

  if (dateCount === 2) {
    // Case 7 — Two dates
    return `I have openings on both ${allDates[0]} and ${allDates[1]}. The earliest is ${firstSlot.time} on ${firstDate} ${withStaff}. Which day works better?`;
  }

  // Case 8 — Three or more dates
  return `I have openings across ${dateCount} days, starting ${firstDate}. The earliest is ${firstSlot.time} ${withStaff}. Which day works best for you?`;
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
    // Hardcoded availability for halo-spa demo merchant
    const merchantId = getMerchantId(c);
    if (merchantId === 'halo-spa') {
      const args = getRequestArgs<VoiceAvailabilityArgs>(c);
      const serviceName = args.service_name || 'Requested service';
      const datePreference = args.date_preference || 'your requested date';
      const staffName = args.staff_name || 'Any available staff';
      const tz = 'America/Los_Angeles';

      // Parse the natural language date into a human-readable formatted date
      const dateRange = parseNaturalDateTime(datePreference, { timezone: tz });
      const formattedDate = dateRange.humanReadable;

      // Build time slots based on whether a specific time was requested
      let slots: { time: string; staff: string[] }[];

      if (!dateRange.isRange && dateRange.startAt) {
        // Specific time requested (e.g., "tomorrow at 2pm") — return that exact time
        const requestedTime = new Date(dateRange.startAt).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: tz,
        });
        slots = [{ time: requestedTime, staff: [staffName] }];
      } else {
        // No specific time — return a few mid-day slots
        slots = [
          { time: '10:00 AM', staff: [staffName] },
          { time: '11:00 AM', staff: [staffName] },
          { time: '1:00 PM', staff: [staffName] },
          { time: '2:00 PM', staff: [staffName] },
          { time: '3:00 PM', staff: [staffName] },
        ];
      }

      const timeList = slots.map(s => s.time).join(', ');
      const summary = slots.length === 1
        ? `Yes, ${staffName} is available for ${serviceName} on ${formattedDate} at ${slots[0].time}. Would you like to go ahead and book it?`
        : `Yes, ${staffName} has availability for ${serviceName} on ${formattedDate}. Available times include ${timeList}. Which time works best for you?`;

      return c.json(successResponse({
        all_staff: [staffName],
        availability: {
          [formattedDate]: slots,
        },
        service_name: serviceName,
        location_name: 'Halo Spa',
        total_slots: slots.length,
        slots_shown: slots.length,
        summary,
      }));
    }

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

    // 3. Resolve staff
    // We always need to pass team member IDs to the segment filter so Square
    // returns availability for ALL staff members, not just one per time slot.
    let staffMemberIds: string[];
    const allStaffForFilter = await listStaff(squareClient, locationId);

    if (args.staff_name && args.staff_name.toLowerCase() !== 'anyone' && args.staff_name.toLowerCase() !== 'any') {
      // Specific staff requested — filter to just that person
      const staffResult = await resolveStaffName(squareClient, args.staff_name, locationId);
      if (staffResult.confidence === 'none') {
        return c.json(errorResponse(
          `I couldn't find a staff member named "${args.staff_name}". Available staff: ${allStaffForFilter.map(s => s.name).join(', ')}.`
        ), 404);
      }
      if (staffResult.confidence === 'ambiguous') {
        return c.json(errorResponse(
          `Multiple staff match. Please specify: ${staffResult.alternatives!.map(s => s.name).join(', ')}.`
        ), 400);
      }
      staffMemberIds = [staffResult.match!.team_member_id];
    } else {
      // No preference or "anyone" — include ALL bookable staff so Square
      // returns separate availability objects for each, allowing us to show
      // which staff members are available at each time slot.
      staffMemberIds = allStaffForFilter.map(s => s.team_member_id);
    }

    // 4. Parse date preference
    const location = await getLocation(squareClient, locationId);
    const dateRange = parseNaturalDateTime(args.date_preference, {
      timezone: location.timezone,
    });

    // 5. Build segment filter — always include team member IDs
    const segmentFilter: SegmentFilter = {
      serviceVariationId: service.variation_id,
      teamMemberIdFilter: { any: staffMemberIds },
    };

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

    // 7. Build staff ID → name map (reuse staff already fetched in step 3)
    const staffIdToName: Record<string, string> = {};
    for (const s of allStaffForFilter) {
      staffIdToName[s.team_member_id] = s.name;
    }

    // 8. Group by date → time, deduplicating and attaching staff names per slot
    const MAX_SLOTS_PER_DATE = 5;
    const MAX_DATES = 5;

    const slotsByDate: Record<string, { time: string; staff: string[] }[]> = {};
    const allStaffNames = new Set<string>();
    let totalSlots = 0;

    for (const avail of availabilities) {
      const a = avail as unknown as Record<string, unknown>;
      const startAt = a.startAt as string;

      // Extract team member ID from the appointment segment
      const segments = a.appointmentSegments as Array<Record<string, unknown>> | undefined;
      const teamMemberId = segments?.[0]?.teamMemberId as string | undefined;
      const memberName = teamMemberId ? staffIdToName[teamMemberId] : undefined;

      // Skip entries where we can't resolve the staff member
      if (!memberName) continue;

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

      // Find existing slot for this date+time or create a new one
      let slot = slotsByDate[date].find(s => s.time === time);
      if (!slot) {
        totalSlots++;
        slot = { time, staff: [] };
        slotsByDate[date].push(slot);
      }

      if (!slot.staff.includes(memberName)) {
        slot.staff.push(memberName);
      }
      allStaffNames.add(memberName);
    }

    // 9. Cap results to keep the response concise
    const allDates = Object.keys(slotsByDate);
    const cappedDates = allDates.slice(0, MAX_DATES);
    const cappedAvailability: Record<string, { time: string; staff: string[] }[]> = {};
    let slotsShown = 0;

    for (const date of cappedDates) {
      cappedAvailability[date] = slotsByDate[date].slice(0, MAX_SLOTS_PER_DATE);
      slotsShown += cappedAvailability[date].length;
    }

    // 10. Generate conversational summary
    const serviceName = getServiceDisplayName(service);
    const summary = buildAvailabilitySummary(
      totalSlots,
      slotsByDate,
      [...allStaffNames],
      serviceName,
      dateRange.humanReadable,
    );

    return c.json(successResponse({
      all_staff: [...allStaffNames],
      availability: cappedAvailability,
      service_name: serviceName,
      location_name: locationName,
      total_slots: totalSlots,
      slots_shown: slotsShown,
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

    // 3. Resolve staff (required)
    if (!args.staff_name) {
      return c.json(errorResponse('Do you have a preference for which staff member you see, or would you like me to book with whoever is available?'), 400);
    }

    let teamMemberId: string;
    let staffName: string;
    const isAnyStaff = ['anyone', 'any'].includes(args.staff_name.toLowerCase());

    if (isAnyStaff) {
      // Pick the first available bookable team member for this location
      const allStaff = await listStaff(squareClient, locationId);
      if (allStaff.length === 0) {
        return c.json(errorResponse('There are no staff members available for booking at this location right now.'), 404);
      }
      teamMemberId = allStaff[0].team_member_id;
      staffName = allStaff[0].name;
    } else {
      // Resolve the named staff member
      const staffResult = await resolveStaffName(squareClient, args.staff_name, locationId);
      if (staffResult.confidence === 'none' || !staffResult.match) {
        const allStaff = await listStaff(squareClient, locationId);
        const staffNames = allStaff.map(s => s.name).join(', ');
        return c.json(errorResponse(
          `I wasn't able to find someone by that name. Our available staff are: ${staffNames}. Would any of them work for you?`
        ), 404);
      }
      if (staffResult.confidence === 'ambiguous') {
        const options = staffResult.alternatives!.map(s => s.name).join(', ');
        return c.json(errorResponse(
          `Multiple staff members match "${args.staff_name}". Could you be more specific? Options: ${options}.`
        ), 400);
      }
      teamMemberId = staffResult.match.team_member_id;
      staffName = staffResult.match.name;
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
      teamMemberId,
    };

    const bookingData: Record<string, unknown> = {
      locationId,
      startAt,
      appointmentSegments: [appointmentSegment],
    };

    // Add customer if a valid-looking ID is provided
    // Voice agents may pass placeholder values like "none" or "unknown"
    const customerId = args.customer_id?.trim();
    if (customerId && customerId.length > 4 && !/^(none|unknown|n\/a|null|undefined)$/i.test(customerId)) {
      bookingData.customerId = customerId;
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
    const summary = `Great! I've booked your ${getServiceDisplayName(service)} for ${appointmentTime} at ${locationName} with ${staffName}. Your confirmation number is ${(booking.id as string).slice(-6)}.`;

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
