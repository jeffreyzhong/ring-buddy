import { Hono } from 'hono';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { createClerkClient } from '@clerk/backend';
import { prisma } from '../../lib/prisma';
import { errorResponse, successResponse } from '../../types';

const app = new Hono();

/**
 * Clerk webhook endpoint
 * 
 * Handles webhooks from Clerk, specifically the user.created event.
 * When a new user is created in Clerk, this endpoint creates a corresponding
 * user record in the Supabase users table.
 */
app.post('/clerk', async (c) => {
  try {
    // Get the webhook signing secret from environment
    const signingSecret = process.env.CLERK_WEBHOOK_SIGNING_SECRET;
    
    if (!signingSecret) {
      console.error('CLERK_WEBHOOK_SIGNING_SECRET environment variable is not set');
      return c.json(errorResponse('Webhook configuration error'), 500);
    }

    // Verify the webhook signature
    // Use the raw request object which is compatible with Clerk's verifyWebhook
    let evt;
    try {
      evt = await verifyWebhook(c.req.raw, {
        signingSecret,
      });
    } catch (err) {
      console.error('Webhook verification failed:', err);
      return c.json(errorResponse('Invalid webhook signature'), 401);
    }

    // Handle user.created event
    if (evt.type === 'user.created') {
      const webhookUserData = evt.data;
      
      // Extract user ID from webhook payload
      const clerkUserId = webhookUserData.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }

      // Check if user already exists (idempotency)
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });

      if (existingUser) {
        console.log('User already exists:', clerkUserId);
        return c.json(
          successResponse({
            message: 'User already exists',
            clerk_user_id: clerkUserId,
          }),
          200
        );
      }

      // Fetch full user data from Clerk API to get organization memberships
      // The webhook payload doesn't include organization information
      const clerkSecretKey = process.env.CLERK_SECRET_KEY;
      if (!clerkSecretKey) {
        console.error('CLERK_SECRET_KEY environment variable is not set');
        return c.json(errorResponse('Clerk API configuration error'), 500);
      }

      const clerkClient = createClerkClient({ secretKey: clerkSecretKey });
      let fullUserData;
      try {
        fullUserData = await clerkClient.users.getUser(clerkUserId);
      } catch (err) {
        console.error('Failed to fetch user from Clerk API:', err);
        return c.json(errorResponse('Failed to retrieve user data from Clerk'), 500);
      }
      
      // Get primary email address
      // Try to find email by primary_email_address_id first, then fall back to first verified email
      let primaryEmail = fullUserData.emailAddresses?.find(
        (email) => email.id === fullUserData.primaryEmailAddressId
      )?.emailAddress;

      // Fallback to first verified email if primary_email_address_id doesn't match
      if (!primaryEmail && fullUserData.emailAddresses?.length) {
        primaryEmail = fullUserData.emailAddresses.find(
          (email) => email.verification?.status === 'verified'
        )?.emailAddress || fullUserData.emailAddresses[0]?.emailAddress;
      }

      if (!primaryEmail) {
        console.error('No email found for user:', clerkUserId);
        return c.json(errorResponse('User has no email address'), 400);
      }

      // Extract first and last name
      const firstName = fullUserData.firstName || '';
      const lastName = fullUserData.lastName || '';

      // Extract organization ID from organization_memberships if available
      // Users can belong to multiple organizations, so we take the first one
      // Access via raw JSON since organization_memberships is not a direct property on User class
      const organizationId = fullUserData.raw?.organization_memberships?.[0]?.organization?.id || null;

      // Create new user in database
      const newUser = await prisma.users.create({
        data: {
          clerk_user_id: clerkUserId,
          email: primaryEmail,
          first_name: firstName,
          last_name: lastName,
          // clerk_organization_id is optional, set to null if not provided
          clerk_organization_id: organizationId,
        },
      });

      console.log('Created new user:', newUser.id, clerkUserId);

      return c.json(
        successResponse({
          message: 'User created successfully',
          user_id: newUser.id.toString(),
          clerk_user_id: clerkUserId,
          email: primaryEmail,
        }),
        201
      );
    }

    // For other event types, just acknowledge receipt
    console.log('Received webhook event:', evt.type);
    return c.json(
      successResponse({
        message: 'Webhook received',
        event_type: evt.type,
      }),
      200
    );
  } catch (error) {
    console.error('Webhook processing error:', error);
    return c.json(
      errorResponse(
        error instanceof Error ? error.message : 'Failed to process webhook'
      ),
      500
    );
  }
});

/**
 * GET endpoint for testing/debugging
 */
app.get('/clerk', (c) => {
  return c.json({
    name: 'clerk-webhook',
    description: 'Clerk webhook endpoint for user.created events',
    method: 'POST',
    endpoint: '/webhooks/clerk',
    events: ['user.created'],
  });
});

export default app;
