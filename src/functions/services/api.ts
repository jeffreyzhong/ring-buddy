import { Hono } from 'hono';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type ServiceListArgs,
  type ServiceGetArgs,
  type ServiceInfo,
} from '../../types';

const app = new Hono();

/**
 * Transform Square catalog item/variation to simplified ServiceInfo
 */
function transformService(
  item: Record<string, unknown>,
  variation: Record<string, unknown>
): ServiceInfo {
  const itemData = item.itemData as Record<string, unknown> | undefined;
  const variationData = variation.itemVariationData as Record<string, unknown> | undefined;
  const priceMoney = variationData?.priceMoney as Record<string, unknown> | undefined;
  
  // Item name is the service name (e.g., "Women's Haircut")
  // Variation name is the tier/option (e.g., "Regular", "Senior", "Child")
  const serviceName = (itemData?.name as string | undefined) || 'Unknown Service';
  const variationName = variationData?.name as string | undefined;
  
  // Format duration for speech (e.g., "60 minutes", "1 hour 30 minutes")
  let duration: string | undefined;
  if (variationData?.serviceDuration) {
    const minutes = Number(variationData.serviceDuration) / 60000;
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const remainingMinutes = minutes % 60;
      duration = remainingMinutes > 0 
        ? `${hours} hour${hours > 1 ? 's' : ''} ${remainingMinutes} minutes`
        : `${hours} hour${hours > 1 ? 's' : ''}`;
    } else {
      duration = `${minutes} minutes`;
    }
  }
  
  // Format price for speech (e.g., "$120.00")
  let price: string | undefined;
  if (priceMoney) {
    const amount = Number(priceMoney.amount) / 100;
    price = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: priceMoney.currency as string,
    }).format(amount);
  }
  
  return {
    service_id: item.id as string,
    variation_id: variation.id as string,
    service_name: serviceName,
    variation_name: variationName,
    description: itemData?.description as string | undefined,
    duration,
    price,
  };
}

/**
 * List all bookable services
 */
app.post('/list', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const args: ServiceListArgs = body.arguments || body;

    // Search for items of type APPOINTMENTS_SERVICE
    const response = await squareClient.catalog.search({
      objectTypes: ['ITEM'],
      query: {
        exactQuery: {
          attributeName: 'product_type',
          attributeValue: 'APPOINTMENTS_SERVICE',
        },
      },
    });

    const items = response.objects || [];
    const services: ServiceInfo[] = [];

    for (const item of items) {
      const itemRecord = item as unknown as Record<string, unknown>;
      const itemData = itemRecord.itemData as Record<string, unknown> | undefined;
      const variations = itemData?.variations as Array<Record<string, unknown>> | undefined;

      if (!variations) continue;

      // Check location availability if location_id provided
      for (const variation of variations) {
        const variationData = variation.itemVariationData as Record<string, unknown> | undefined;
        const locationOverrides = variationData?.locationOverrides as Array<Record<string, unknown>> | undefined;
        
        // If location_id specified, check if service is available at that location
        if (args.location_id && locationOverrides) {
          const locationOverride = locationOverrides.find(
            (lo) => lo.locationId === args.location_id
          );
          // Skip if explicitly sold out at this location
          if (locationOverride?.soldOut === true) continue;
        }

        services.push(transformService(itemRecord, variation));
      }
    }

    return c.json(successResponse({
      count: services.length,
      services,
    }));
  } catch (error) {
    console.error('Services list error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Get details for a specific service
 */
app.post('/get', async (c) => {
  try {
    const body = await c.req.json();
    const args: ServiceGetArgs = body.arguments || body;

    if (!args.service_id) {
      return c.json(errorResponse('Missing required parameter: service_id'), 400);
    }

    const response = await squareClient.catalog.object.get({
      objectId: args.service_id,
      includeRelatedObjects: true,
    });

    if (!response.object) {
      return c.json(errorResponse('Service not found'), 404);
    }

    const item = response.object as unknown as Record<string, unknown>;
    const itemData = item.itemData as Record<string, unknown> | undefined;
    const variations = itemData?.variations as Array<Record<string, unknown>> | undefined;

    if (!variations || variations.length === 0) {
      return c.json(errorResponse('Service has no variations'), 404);
    }

    // Return the first variation (or we could return all)
    const service = transformService(item, variations[0]);

    return c.json(successResponse({ service }));
  } catch (error) {
    console.error('Service get error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'services',
    description: 'Service catalog endpoints for voice agent',
    endpoints: [
      {
        path: '/list',
        method: 'POST',
        description: 'List all bookable services (optionally filtered by location)',
        parameters: {
          location_id: { type: 'string', required: false, description: 'Filter by location ID' },
        },
      },
      {
        path: '/get',
        method: 'POST',
        description: 'Get details for a specific service',
        parameters: {
          service_id: { type: 'string', required: true, description: 'Square catalog item ID' },
        },
      },
    ],
  });
});

export default app;
