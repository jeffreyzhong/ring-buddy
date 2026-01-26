import { Hono } from 'hono';
import type { SegmentFilter } from 'square';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type AvailabilitySearchArgs,
  type AvailabilitySlot,
} from '../../types';

const app = new Hono();

/**
 * Format date to RFC 3339 format with time
 */
function formatDateToRFC3339(dateStr: string, endOfDay = false): string {
  // If already in RFC 3339 format, return as-is
  if (dateStr.includes('T')) {
    return dateStr;
  }
  
  // Parse YYYY-MM-DD format
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  
  if (endOfDay) {
    date.setHours(23, 59, 59, 999);
  } else {
    date.setHours(0, 0, 0, 0);
  }
  
  return date.toISOString();
}

/**
 * Format time slot for voice agent
 */
function formatTimeSlot(isoDate: string, timezone?: string): string {
  const date = new Date(isoDate);
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}

/**
 * Search for available appointment time slots
 */
app.post('/search', async (c) => {
  try {
    const body = await c.req.json();
    const args: AvailabilitySearchArgs = body.arguments || body;

    // Validate required parameters
    if (!args.location_id) {
      return c.json(errorResponse('Missing required parameter: location_id'), 400);
    }
    if (!args.service_variation_id) {
      return c.json(errorResponse('Missing required parameter: service_variation_id'), 400);
    }
    if (!args.start_date) {
      return c.json(errorResponse('Missing required parameter: start_date'), 400);
    }
    if (!args.end_date) {
      return c.json(errorResponse('Missing required parameter: end_date'), 400);
    }

    // Build segment filter for the service
    const segmentFilter: SegmentFilter = {
      serviceVariationId: args.service_variation_id,
    };

    // Add team member filter if specified
    if (args.staff_member_ids && args.staff_member_ids.length > 0) {
      segmentFilter.teamMemberIdFilter = {
        any: args.staff_member_ids,
      };
    }

    const response = await squareClient.bookings.searchAvailability({
      query: {
        filter: {
          startAtRange: {
            startAt: formatDateToRFC3339(args.start_date),
            endAt: formatDateToRFC3339(args.end_date, true),
          },
          locationId: args.location_id,
          segmentFilters: [segmentFilter],
        },
      },
    });

    const availabilities = response.availabilities || [];

    // Get location timezone for formatting
    let timezone: string | undefined;
    try {
      const locationResponse = await squareClient.locations.get({ locationId: args.location_id });
      timezone = (locationResponse.location as unknown as Record<string, unknown>)?.timezone as string;
    } catch {
      // Use default if we can't get timezone
    }

    const slots: AvailabilitySlot[] = availabilities.map((avail) => {
      const a = avail as unknown as Record<string, unknown>;
      const appointmentSegments = a.appointmentSegments as Array<Record<string, unknown>> | undefined;
      
      return {
        start_at: a.startAt as string,
        location_id: a.locationId as string,
        team_member_id: appointmentSegments?.[0]?.teamMemberId as string | undefined,
        service_variation_id: appointmentSegments?.[0]?.serviceVariationId as string || args.service_variation_id,
        formatted_time: formatTimeSlot(a.startAt as string, timezone),
      };
    });

    // Group slots by date for easier voice agent presentation
    const slotsByDate: Record<string, AvailabilitySlot[]> = {};
    for (const slot of slots) {
      const date = new Date(slot.start_at).toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: timezone,
      });
      if (!slotsByDate[date]) {
        slotsByDate[date] = [];
      }
      slotsByDate[date].push(slot);
    }

    return c.json(successResponse({
      total_slots: slots.length,
      slots,
      slots_by_date: slotsByDate,
      search_criteria: {
        location_id: args.location_id,
        service_variation_id: args.service_variation_id,
        start_date: args.start_date,
        end_date: args.end_date,
        staff_member_ids: args.staff_member_ids,
      },
    }));
  } catch (error) {
    console.error('Availability search error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'availability',
    description: 'Time slot availability search for voice agent',
    endpoints: [
      {
        path: '/search',
        method: 'POST',
        description: 'Search for available appointment time slots',
        parameters: {
          location_id: { type: 'string', required: true, description: 'Square location ID' },
          service_variation_id: { type: 'string', required: true, description: 'Service variation ID' },
          start_date: { type: 'string', required: true, description: 'Start date (YYYY-MM-DD)' },
          end_date: { type: 'string', required: true, description: 'End date (YYYY-MM-DD)' },
          staff_member_ids: { type: 'array', required: false, description: 'Filter by specific staff' },
        },
      },
    ],
  });
});

export default app;
