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
 * - Consecutive days grouped: "Monday through Wednesday 9:00 AM to 5:00 PM"
 * - Alternating days: "Monday, Wednesday, and Friday 9:00 AM to 5:00 PM, Tuesday and Thursday 10:00 AM to 6:00 PM"
 */
function formatBusinessHours(businessHours: unknown): string {
  // Handle array format (direct periods array)
  let periods: Array<Record<string, unknown>> | undefined;
  if (Array.isArray(businessHours)) {
    periods = businessHours;
  } else if (businessHours && typeof businessHours === 'object') {
    periods = (businessHours as { periods?: Array<Record<string, unknown>> }).periods;
  }
  
  if (!periods || periods.length === 0) {
    return 'Hours not available';
  }

  // Square API may return abbreviated (MON) or full day names (MONDAY)
  const dayOrder = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
  const fullDayOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const dayNames: Record<string, string> = {
    'MON': 'Monday', 'MONDAY': 'Monday',
    'TUE': 'Tuesday', 'TUESDAY': 'Tuesday',
    'WED': 'Wednesday', 'WEDNESDAY': 'Wednesday',
    'THU': 'Thursday', 'THURSDAY': 'Thursday',
    'FRI': 'Friday', 'FRIDAY': 'Friday',
    'SAT': 'Saturday', 'SATURDAY': 'Saturday',
    'SUN': 'Sunday', 'SUNDAY': 'Sunday',
  };
  
  // Normalize day to abbreviated form for ordering
  const normalizeDay = (day: string): string => {
    const fullIndex = fullDayOrder.indexOf(day);
    return fullIndex >= 0 ? dayOrder[fullIndex] : day;
  };

  // Sort periods by day order (handle both snake_case and camelCase)
  const sortedPeriods = [...periods].sort((a, b) => {
    const dayA = normalizeDay((a.day_of_week || a.dayOfWeek) as string);
    const dayB = normalizeDay((b.day_of_week || b.dayOfWeek) as string);
    return dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
  });

  // Create a map of day -> hours string
  // Square SDK uses camelCase (dayOfWeek, startLocalTime, endLocalTime)
  // but raw API uses snake_case - check for both
  const dayHours: Record<string, string> = {};
  for (const period of sortedPeriods) {
    const rawDay = (period.day_of_week || period.dayOfWeek) as string;
    const day = normalizeDay(rawDay);
    const startTime = (period.start_local_time || period.startLocalTime) as string;
    const endTime = (period.end_local_time || period.endLocalTime) as string;
    
    if (!day || !startTime || !endTime) continue;
    
    const start = formatTime(startTime);
    const end = formatTime(endTime);
    dayHours[day] = `${start} to ${end}`;
  }

  // Get unique hour patterns
  const uniqueHours = [...new Set(Object.values(dayHours))];

  // Case 1: All 7 days have the same hours
  if (uniqueHours.length === 1 && Object.keys(dayHours).length === 7) {
    return `Open daily from ${uniqueHours[0]}`;
  }

  // Group days by their hours (regardless of whether consecutive)
  const hoursToDays: Map<string, string[]> = new Map();
  for (const day of dayOrder) {
    const hours = dayHours[day];
    if (!hours) continue; // Skip closed days
    
    if (!hoursToDays.has(hours)) {
      hoursToDays.set(hours, []);
    }
    hoursToDays.get(hours)!.push(day);
  }

  // Check if days in a group are consecutive
  const areConsecutive = (days: string[]): boolean => {
    if (days.length <= 1) return true;
    for (let i = 1; i < days.length; i++) {
      const prevIndex = dayOrder.indexOf(days[i - 1]);
      const currIndex = dayOrder.indexOf(days[i]);
      if (currIndex !== prevIndex + 1) return false;
    }
    return true;
  };

  // Format a list of days
  const formatDayList = (days: string[]): string => {
    if (days.length === 1) {
      return dayNames[days[0]];
    } else if (days.length === 2) {
      return `${dayNames[days[0]]} and ${dayNames[days[1]]}`;
    } else if (areConsecutive(days)) {
      // Consecutive days: "Monday through Friday"
      return `${dayNames[days[0]]} through ${dayNames[days[days.length - 1]]}`;
    } else {
      // Non-consecutive days: "Monday, Wednesday, and Friday"
      const dayNamesList = days.map(d => dayNames[d]);
      const lastDay = dayNamesList.pop();
      return `${dayNamesList.join(', ')}, and ${lastDay}`;
    }
  };

  // Format output - maintain order by first day in each group
  const groups = Array.from(hoursToDays.entries())
    .sort((a, b) => {
      const firstDayA = dayOrder.indexOf(a[1][0]);
      const firstDayB = dayOrder.indexOf(b[1][0]);
      return firstDayA - firstDayB;
    });

  // If no groups, return not available
  if (groups.length === 0) {
    return 'Hours not available';
  }

  const parts = groups.map(([hours, days]) => {
    const dayList = formatDayList(days);
    return `${dayList} ${hours}`;
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
  const businessHours = location.businessHours;
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
