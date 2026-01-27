import { Hono } from 'hono';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type LocationGetArgs,
  type LocationInfo,
} from '../../types';

const app = new Hono();

/**
 * Format time from 24h to 12h format (e.g., "09:00:00" -> "9:00 AM")
 */
function formatTime(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 || 12;
  return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Format business hours into human-readable format for TTS
 * 
 * Handles various cases:
 * - All days same hours: "Open daily from 9:00 AM to 5:00 PM"
 * - Weekdays same, weekend different: "Monday through Friday 9:00 AM to 5:00 PM, Saturday and Sunday 10:00 AM to 4:00 PM"
 * - Consecutive days grouped: "Monday through Wednesday 9:00 AM to 5:00 PM, Thursday through Saturday 10:00 AM to 6:00 PM"
 * - Individual days when needed: "Monday 9:00 AM to 5:00 PM, Tuesday 10:00 AM to 6:00 PM"
 */
function formatBusinessHours(businessHours: { periods?: Array<Record<string, unknown>> } | undefined): string {
  if (!businessHours?.periods || businessHours.periods.length === 0) {
    return 'Hours not available';
  }

  const dayOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const dayNames: Record<string, string> = {
    'MONDAY': 'Monday',
    'TUESDAY': 'Tuesday', 
    'WEDNESDAY': 'Wednesday',
    'THURSDAY': 'Thursday',
    'FRIDAY': 'Friday',
    'SATURDAY': 'Saturday',
    'SUNDAY': 'Sunday',
  };

  // Sort periods by day order
  const sortedPeriods = [...businessHours.periods].sort(
    (a, b) => dayOrder.indexOf(a.dayOfWeek as string) - dayOrder.indexOf(b.dayOfWeek as string)
  );

  // Create a map of day -> hours string
  const dayHours: Record<string, string> = {};
  for (const period of sortedPeriods) {
    const day = period.dayOfWeek as string;
    const start = formatTime(period.startLocalTime as string);
    const end = formatTime(period.endLocalTime as string);
    dayHours[day] = `${start} to ${end}`;
  }

  // Get unique hour patterns
  const uniqueHours = [...new Set(Object.values(dayHours))];

  // Case 1: All days have the same hours
  if (uniqueHours.length === 1 && sortedPeriods.length === 7) {
    return `Open daily from ${uniqueHours[0]}`;
  }

  // Group consecutive days with the same hours
  type DayGroup = { days: string[]; hours: string };
  const groups: DayGroup[] = [];
  
  for (const day of dayOrder) {
    const hours = dayHours[day];
    if (!hours) continue; // Skip closed days
    
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.hours === hours) {
      // Same hours as previous day, add to group
      lastGroup.days.push(day);
    } else {
      // Different hours, start new group
      groups.push({ days: [day], hours });
    }
  }

  // Format each group
  const formatDayRange = (days: string[]): string => {
    if (days.length === 1) {
      return dayNames[days[0]];
    } else if (days.length === 2) {
      return `${dayNames[days[0]]} and ${dayNames[days[1]]}`;
    } else {
      return `${dayNames[days[0]]} through ${dayNames[days[days.length - 1]]}`;
    }
  };

  // Format output
  const parts = groups.map((group) => {
    const dayRange = formatDayRange(group.days);
    return `${dayRange} ${group.hours}`;
  });

  return parts.join(', ');
}

/**
 * Format address for TTS
 */
function formatAddress(address: Record<string, unknown> | undefined): string | undefined {
  if (!address) return undefined;
  
  const parts = [
    address.addressLine1 as string,
    address.locality as string,
    address.administrativeDistrictLevel1 as string,
    address.postalCode as string,
  ].filter(Boolean);
  
  return parts.length > 0 ? parts.join(', ') : undefined;
}

/**
 * Transform Square location to simplified LocationInfo (TTS-optimized)
 */
function transformLocation(location: Record<string, unknown>): LocationInfo {
  const businessHours = location.businessHours as { periods?: Array<Record<string, unknown>> } | undefined;
  const address = location.address as Record<string, unknown> | undefined;
  
  return {
    location_id: location.id as string,
    name: location.name as string,
    address: formatAddress(address),
    phone_number: location.phoneNumber as string | undefined,
    business_hours: formatBusinessHours(businessHours),
  };
}

/**
 * List all business locations
 */
app.post('/list', async (c) => {
  try {
    const response = await squareClient.locations.list();

    const locations = (response.locations || [])
      .filter((loc) => (loc as unknown as Record<string, unknown>).status === 'ACTIVE')
      .map((loc) => transformLocation(loc as unknown as Record<string, unknown>));

    return c.json(successResponse({
      count: locations.length,
      locations,
    }));
  } catch (error) {
    console.error('Locations list error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Get details for a specific location
 */
app.post('/get', async (c) => {
  try {
    const body = await c.req.json();
    const args: LocationGetArgs = body.arguments || body;

    if (!args.location_id) {
      return c.json(errorResponse('Missing required parameter: location_id'), 400);
    }

    const response = await squareClient.locations.get({ locationId: args.location_id });

    if (!response.location) {
      return c.json(errorResponse('Location not found'), 404);
    }

    const location = transformLocation(response.location as unknown as Record<string, unknown>);

    return c.json(successResponse({ location }));
  } catch (error) {
    console.error('Location get error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'locations',
    description: 'Business location endpoints for voice agent',
    endpoints: [
      {
        path: '/list',
        method: 'POST',
        description: 'List all active business locations',
        parameters: {},
      },
      {
        path: '/get',
        method: 'POST',
        description: 'Get details for a specific location including business hours',
        parameters: {
          location_id: { type: 'string', required: true, description: 'Square location ID' },
        },
      },
    ],
  });
});

export default app;
