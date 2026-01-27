import { Hono } from 'hono';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { prisma } from '../../lib/prisma';
import { errorResponse, successResponse } from '../../types';

const app = new Hono();

/**
 * Clerk webhook endpoint
 * 
 * Handles webhooks from Clerk:
 * - user.created: Creates a new user record in the Supabase users table
 * - user.updated: Updates user record when their information changes (email, name, etc.)
 * - user.deleted: Deletes the user record from the Supabase users table
 * - organizationMembership.created: Updates user's organization_id when they join an organization
 * - organizationMembership.updated: Updates user's organization_id when their membership changes (e.g., role change)
 * - organizationMembership.deleted: Sets user's organization_id to null when they leave an organization
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

      // Get primary email address from webhook payload
      const primaryEmail = webhookUserData.email_addresses?.find(
        (email: any) => email.id === webhookUserData.primary_email_address_id
      )?.email_address || webhookUserData.email_addresses?.[0]?.email_address;

      if (!primaryEmail) {
        console.error('No email found for user:', clerkUserId);
        return c.json(errorResponse('User has no email address'), 400);
      }

      // Extract first and last name from webhook payload
      const firstName = webhookUserData.first_name || '';
      const lastName = webhookUserData.last_name || '';

      // Create new user in database
      // Organization info will be set when organizationMembership.created webhook is received
      const newUser = await prisma.users.create({
        data: {
          clerk_user_id: clerkUserId,
          email: primaryEmail,
          first_name: firstName,
          last_name: lastName,
          clerk_organization_id: null, // Will be updated by organizationMembership.created webhook
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

    // Handle user.updated event
    if (evt.type === 'user.updated') {
      const webhookUserData = evt.data;
      
      // Extract user ID from webhook payload
      const clerkUserId = webhookUserData.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in user.updated webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }

      // Find the user in the database
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });

      if (!existingUser) {
        console.warn('User not found in database when processing user.updated:', clerkUserId);
        // User doesn't exist - this might happen if user.updated fires before user.created
        // We could create the user here, but it's safer to wait for user.created
        return c.json(
          successResponse({
            message: 'User not found - will be created when user.created webhook is received',
            clerk_user_id: clerkUserId,
          }),
          200
        );
      }

      // Get primary email address from webhook payload
      const primaryEmail = webhookUserData.email_addresses?.find(
        (email: any) => email.id === webhookUserData.primary_email_address_id
      )?.email_address || webhookUserData.email_addresses?.[0]?.email_address;

      if (!primaryEmail) {
        console.error('No email found for user in user.updated webhook:', clerkUserId);
        return c.json(errorResponse('User has no email address'), 400);
      }

      // Extract first and last name from webhook payload
      const firstName = webhookUserData.first_name || '';
      const lastName = webhookUserData.last_name || '';

      // Update user record in database
      // Note: We don't update clerk_organization_id here - that's handled by organizationMembership webhooks
      const updatedUser = await prisma.users.update({
        where: { clerk_user_id: clerkUserId },
        data: {
          email: primaryEmail,
          first_name: firstName,
          last_name: lastName,
        },
      });

      console.log('Updated user:', clerkUserId);

      return c.json(
        successResponse({
          message: 'User updated successfully',
          user_id: updatedUser.id.toString(),
          clerk_user_id: clerkUserId,
          email: primaryEmail,
        }),
        200
      );
    }

    // Handle user.deleted event
    if (evt.type === 'user.deleted') {
      const deletedUserData = evt.data;
      
      // Extract user ID from webhook payload
      const clerkUserId = deletedUserData.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in user.deleted webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }
      
      // Find the user in the database
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        console.log('User not found in database when processing user.deleted:', clerkUserId);
        // User doesn't exist - this is okay, just acknowledge
        return c.json(
          successResponse({
            message: 'User not found - no action needed',
            clerk_user_id: clerkUserId,
          }),
          200
        );
      }
      
      // Delete the user record
      await prisma.users.delete({
        where: { clerk_user_id: clerkUserId },
      });
      
      console.log('Deleted user:', clerkUserId);
      
      return c.json(
        successResponse({
          message: 'User deleted successfully',
          clerk_user_id: clerkUserId,
        }),
        200
      );
    }

    // Handle organizationMembership.created event
    if (evt.type === 'organizationMembership.created') {
      const membershipData = evt.data;
      
      // Extract user ID and organization ID from webhook payload
      const clerkUserId = membershipData.public_user_data?.user_id;
      const organizationId = membershipData.organization?.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in organizationMembership.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }
      
      if (!organizationId) {
        console.error('Missing organization ID in organizationMembership.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      // Find the user in the database
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        console.warn('User not found in database when processing organizationMembership.created:', clerkUserId);
        // User might not exist yet if organizationMembership.created fires before user.created
        // This is okay - we'll update when user.created fires, or they can be updated later
        return c.json(
          successResponse({
            message: 'User not found - will be updated when user record is created',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
          }),
          200
        );
      }
      
      // Update user's organization ID
      const updatedUser = await prisma.users.update({
        where: { clerk_user_id: clerkUserId },
        data: {
          clerk_organization_id: organizationId,
        },
      });
      
      console.log('Updated user organization:', clerkUserId, '->', organizationId);
      
      return c.json(
        successResponse({
          message: 'User organization updated successfully',
          clerk_user_id: clerkUserId,
          organization_id: organizationId,
          user_id: updatedUser.id.toString(),
        }),
        200
      );
    }

    // Handle organizationMembership.updated event
    if (evt.type === 'organizationMembership.updated') {
      const membershipData = evt.data;
      
      // Extract user ID and organization ID from webhook payload
      const clerkUserId = membershipData.public_user_data?.user_id;
      const organizationId = membershipData.organization?.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in organizationMembership.updated webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }
      
      if (!organizationId) {
        console.error('Missing organization ID in organizationMembership.updated webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      // Find the user in the database
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        console.warn('User not found in database when processing organizationMembership.updated:', clerkUserId);
        // User might not exist yet - this is okay, just acknowledge
        return c.json(
          successResponse({
            message: 'User not found - will be updated when user record is created',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
          }),
          200
        );
      }
      
      // Update user's organization ID (this ensures it's current even if role/permissions changed)
      const updatedUser = await prisma.users.update({
        where: { clerk_user_id: clerkUserId },
        data: {
          clerk_organization_id: organizationId,
        },
      });
      
      console.log('Updated user organization membership:', clerkUserId, '->', organizationId);
      
      return c.json(
        successResponse({
          message: 'User organization membership updated successfully',
          clerk_user_id: clerkUserId,
          organization_id: organizationId,
          user_id: updatedUser.id.toString(),
        }),
        200
      );
    }

    // Handle organizationMembership.deleted event
    if (evt.type === 'organizationMembership.deleted') {
      const membershipData = evt.data;
      
      // Extract user ID and organization ID from webhook payload
      const clerkUserId = membershipData.public_user_data?.user_id;
      const organizationId = membershipData.organization?.id;
      
      if (!clerkUserId) {
        console.error('Missing user ID in organizationMembership.deleted webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }
      
      if (!organizationId) {
        console.error('Missing organization ID in organizationMembership.deleted webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      // Find the user in the database
      const existingUser = await prisma.users.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        console.warn('User not found in database when processing organizationMembership.deleted:', clerkUserId);
        // User might not exist - this is okay, just acknowledge
        return c.json(
          successResponse({
            message: 'User not found - no action needed',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
          }),
          200
        );
      }
      
      // Only update if the user's current organization_id matches the one being deleted
      // This handles cases where a user might belong to multiple organizations
      // (though we only store one organization_id in the database)
      if (existingUser.clerk_organization_id === organizationId) {
        // Update user's organization ID to null
        const updatedUser = await prisma.users.update({
          where: { clerk_user_id: clerkUserId },
          data: {
            clerk_organization_id: null,
          },
        });
        
        console.log('Removed user from organization:', clerkUserId, '->', organizationId);
        
        return c.json(
          successResponse({
            message: 'User organization removed successfully',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
            user_id: updatedUser.id.toString(),
          }),
          200
        );
      } else {
        // User's organization_id doesn't match - they might have already joined another org
        console.log('User organization_id does not match deleted membership:', {
          userId: clerkUserId,
          currentOrgId: existingUser.clerk_organization_id,
          deletedOrgId: organizationId,
        });
        
        return c.json(
          successResponse({
            message: 'User organization already updated - no change needed',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
            current_organization_id: existingUser.clerk_organization_id,
          }),
          200
        );
      }
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
    description: 'Clerk webhook endpoint for user and organization membership events',
    method: 'POST',
    endpoint: '/webhooks/clerk',
    events: [
      'user.created',
      'user.updated',
      'user.deleted',
      'organizationMembership.created',
      'organizationMembership.updated',
      'organizationMembership.deleted',
    ],
  });
});

export default app;
