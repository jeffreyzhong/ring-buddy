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
 * Transform Square location to simplified LocationInfo
 */
function transformLocation(location: Record<string, unknown>): LocationInfo {
  const businessHours = location.businessHours as { periods?: Array<Record<string, unknown>> } | undefined;
  const address = location.address as Record<string, unknown> | undefined;
  
  return {
    id: location.id as string,
    name: location.name as string,
    address: address ? {
      address_line_1: address.addressLine1 as string | undefined,
      locality: address.locality as string | undefined,
      administrative_district_level_1: address.administrativeDistrictLevel1 as string | undefined,
      postal_code: address.postalCode as string | undefined,
    } : undefined,
    phone_number: location.phoneNumber as string | undefined,
    business_hours: businessHours?.periods?.map((period) => ({
      day_of_week: period.dayOfWeek as string,
      start_local_time: period.startLocalTime as string,
      end_local_time: period.endLocalTime as string,
    })),
    timezone: location.timezone as string | undefined,
  };
}

/**
 * Format business hours into human-readable format
 */
function formatBusinessHours(hours?: LocationInfo['business_hours']): string {
  if (!hours || hours.length === 0) {
    return 'Hours not available';
  }

  const dayOrder = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
  const sortedHours = [...hours].sort(
    (a, b) => dayOrder.indexOf(a.day_of_week) - dayOrder.indexOf(b.day_of_week)
  );

  return sortedHours
    .map((h) => {
      const day = h.day_of_week.charAt(0) + h.day_of_week.slice(1).toLowerCase();
      return `${day}: ${h.start_local_time} - ${h.end_local_time}`;
    })
    .join(', ');
}

/**
 * List all business locations
 */
app.post('/list', async (c) => {
  try {
    const response = await squareClient.locations.list();

    const locations = (response.locations || [])
      .filter((loc) => (loc as unknown as Record<string, unknown>).status === 'ACTIVE')
      .map((loc) => {
        const location = transformLocation(loc as unknown as Record<string, unknown>);
        return {
          ...location,
          formatted_hours: formatBusinessHours(location.business_hours),
          formatted_address: location.address
            ? `${location.address.address_line_1 || ''}, ${location.address.locality || ''}, ${location.address.administrative_district_level_1 || ''} ${location.address.postal_code || ''}`.trim()
            : undefined,
        };
      });

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

    return c.json(successResponse({
      location: {
        ...location,
        formatted_hours: formatBusinessHours(location.business_hours),
        formatted_address: location.address
          ? `${location.address.address_line_1 || ''}, ${location.address.locality || ''}, ${location.address.administrative_district_level_1 || ''} ${location.address.postal_code || ''}`.trim()
          : undefined,
      },
    }));
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
