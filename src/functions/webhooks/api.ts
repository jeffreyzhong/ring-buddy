import { Hono } from 'hono';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { prisma } from '../../lib/prisma';
import { errorResponse, successResponse } from '../../types';

const app = new Hono();

/**
 * Clerk webhook endpoint
 * 
 * Handles webhooks from Clerk:
 * - user.updated: Updates user record when their information changes (email, name, etc.)
 * - user.deleted: Deletes the user record from the database
 * - organization.created: Creates organization record when a new organization is created
 * - organization.updated: Updates organization record when organization info changes (e.g., name)
 * - organization.deleted: Deletes organization record and cascades to related records (users, locations, etc.)
 * - organizationMembership.created: Creates user record and sets organization_id when they join an organization
 * - organizationMembership.updated: Updates user's organization_id when their membership changes (e.g., role change)
 * - organizationMembership.deleted: Deletes user when they leave an organization (since clerk_organization_id is required)
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
      const existingUser = await prisma.user.findUnique({
        where: { clerk_user_id: clerkUserId },
      });

      if (!existingUser) {
        console.warn('User not found in database when processing user.updated:', clerkUserId);
        // User doesn't exist - they will be created when they join an organization
        return c.json(
          successResponse({
            message: 'User not found - will be created when organizationMembership.created webhook is received',
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
      const updatedUser = await prisma.user.update({
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
      const existingUser = await prisma.user.findUnique({
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
      await prisma.user.delete({
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

    // Handle organization.created event
    if (evt.type === 'organization.created') {
      const orgData = evt.data;
      
      // Extract organization info from webhook payload
      const clerkOrganizationId = orgData.id;
      const organizationName = orgData.name;
      
      if (!clerkOrganizationId) {
        console.error('Missing organization ID in organization.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      if (!organizationName) {
        console.error('Missing organization name in organization.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization name'), 400);
      }
      
      // Check if organization already exists
      const existingOrg = await prisma.organization.findUnique({
        where: { clerk_organization_id: clerkOrganizationId },
      });
      
      if (existingOrg) {
        console.log('Organization already exists:', clerkOrganizationId);
        return c.json(
          successResponse({
            message: 'Organization already exists',
            clerk_organization_id: clerkOrganizationId,
            organization_id: existingOrg.id.toString(),
          }),
          200
        );
      }
      
      // Create the organization record
      const newOrg = await prisma.organization.create({
        data: {
          clerk_organization_id: clerkOrganizationId,
          clerk_organization_name: organizationName,
        },
      });
      
      console.log('Created organization:', clerkOrganizationId, organizationName);
      
      return c.json(
        successResponse({
          message: 'Organization created successfully',
          clerk_organization_id: clerkOrganizationId,
          organization_name: organizationName,
          organization_id: newOrg.id.toString(),
        }),
        201
      );
    }

    // Handle organization.updated event
    if (evt.type === 'organization.updated') {
      const orgData = evt.data;
      
      // Extract organization info from webhook payload
      const clerkOrganizationId = orgData.id;
      const organizationName = orgData.name;
      
      if (!clerkOrganizationId) {
        console.error('Missing organization ID in organization.updated webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      if (!organizationName) {
        console.error('Missing organization name in organization.updated webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization name'), 400);
      }
      
      // Find the organization in the database
      const existingOrg = await prisma.organization.findUnique({
        where: { clerk_organization_id: clerkOrganizationId },
      });
      
      if (!existingOrg) {
        console.warn('Organization not found in database when processing organization.updated:', clerkOrganizationId);
        // Organization doesn't exist - it will be created when organization.created webhook is received
        return c.json(
          successResponse({
            message: 'Organization not found - will be created when organization.created webhook is received',
            clerk_organization_id: clerkOrganizationId,
          }),
          200
        );
      }
      
      // Update the organization record
      const updatedOrg = await prisma.organization.update({
        where: { clerk_organization_id: clerkOrganizationId },
        data: {
          clerk_organization_name: organizationName,
        },
      });
      
      console.log('Updated organization:', clerkOrganizationId, organizationName);
      
      return c.json(
        successResponse({
          message: 'Organization updated successfully',
          clerk_organization_id: clerkOrganizationId,
          organization_name: organizationName,
          organization_id: updatedOrg.id.toString(),
        }),
        200
      );
    }

    // Handle organization.deleted event
    // Deleting an organization cascades to related records (users, locations, merchant, etc.)
    if (evt.type === 'organization.deleted') {
      const orgData = evt.data;
      
      // Extract organization ID from webhook payload
      const clerkOrganizationId = orgData.id;
      
      if (!clerkOrganizationId) {
        console.error('Missing organization ID in organization.deleted webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      // Find the organization in the database
      const existingOrg = await prisma.organization.findUnique({
        where: { clerk_organization_id: clerkOrganizationId },
      });
      
      if (!existingOrg) {
        console.log('Organization not found in database when processing organization.deleted:', clerkOrganizationId);
        // Organization doesn't exist - this is okay, just acknowledge
        return c.json(
          successResponse({
            message: 'Organization not found - no action needed',
            clerk_organization_id: clerkOrganizationId,
          }),
          200
        );
      }
      
      // Delete the organization record
      // This will cascade delete related records (users, locations, merchant) due to onDelete: Cascade
      await prisma.organization.delete({
        where: { clerk_organization_id: clerkOrganizationId },
      });
      
      console.log('Deleted organization:', clerkOrganizationId);
      
      return c.json(
        successResponse({
          message: 'Organization deleted successfully',
          clerk_organization_id: clerkOrganizationId,
        }),
        200
      );
    }

    // Handle organizationMembership.created event
    if (evt.type === 'organizationMembership.created') {
      const membershipData = evt.data;
      
      // Extract user ID and organization info from webhook payload
      const clerkUserId = membershipData.public_user_data?.user_id;
      const organizationId = membershipData.organization?.id;
      const publicUserData = membershipData.public_user_data;
      
      if (!clerkUserId) {
        console.error('Missing user ID in organizationMembership.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing user ID'), 400);
      }
      
      if (!organizationId) {
        console.error('Missing organization ID in organizationMembership.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing organization ID'), 400);
      }
      
      // Extract user information from public_user_data
      const email = publicUserData?.identifier || '';
      const firstName = publicUserData?.first_name || '';
      const lastName = publicUserData?.last_name || '';
      
      if (!email) {
        console.error('Missing email in organizationMembership.created webhook payload');
        return c.json(errorResponse('Invalid webhook payload: missing email'), 400);
      }
      
      // Find the user in the database
      const existingUser = await prisma.user.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        // Create user record with organization info
        const newUser = await prisma.user.create({
          data: {
            clerk_user_id: clerkUserId,
            email: email,
            first_name: firstName,
            last_name: lastName,
            clerk_organization_id: organizationId,
          },
        });
        
        console.log('Created new user with organization:', newUser.id, clerkUserId, organizationId);
        
        return c.json(
          successResponse({
            message: 'User created with organization successfully',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
            user_id: newUser.id.toString(),
          }),
          201
        );
      }
      
      // Update user's organization ID
      const updatedUser = await prisma.user.update({
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
      
      // Extract user ID and organization info from webhook payload
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
      const existingUser = await prisma.user.findUnique({
        where: { clerk_user_id: clerkUserId },
      });
      
      if (!existingUser) {
        console.warn('User not found in database when processing organizationMembership.updated:', clerkUserId);
        // User might not exist yet - they will be created when organizationMembership.created fires
        return c.json(
          successResponse({
            message: 'User not found - will be created when organizationMembership.created webhook is received',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
          }),
          200
        );
      }
      
      // Update user's organization ID (this ensures it's current even if role/permissions changed)
      const updatedUser = await prisma.user.update({
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
    // Since clerk_organization_id is required, we delete the user when they leave their organization
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
      
      // Find the user in the database with matching organization
      const existingUser = await prisma.user.findFirst({
        where: { 
          clerk_user_id: clerkUserId,
          clerk_organization_id: organizationId,
        },
      });
      
      if (!existingUser) {
        console.warn('User not found in database when processing organizationMembership.deleted:', clerkUserId);
        // User might not exist or belongs to different org - this is okay, just acknowledge
        return c.json(
          successResponse({
            message: 'User not found for this organization - no action needed',
            clerk_user_id: clerkUserId,
            organization_id: organizationId,
          }),
          200
        );
      }
      
      // Delete the user since clerk_organization_id is required
      // User will be recreated if they join another organization
      await prisma.user.delete({
        where: { clerk_user_id: clerkUserId },
      });
      
      console.log('Deleted user after leaving organization:', clerkUserId, 'from org:', organizationId);
      
      return c.json(
        successResponse({
          message: 'User deleted after leaving organization',
          clerk_user_id: clerkUserId,
          organization_id: organizationId,
        }),
        200
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
    description: 'Clerk webhook endpoint for user and organization membership events',
    method: 'POST',
    endpoint: '/webhooks/clerk',
    events: [
      'user.updated',
      'user.deleted',
      'organization.created',
      'organization.updated',
      'organization.deleted',
      'organizationMembership.created',
      'organizationMembership.updated',
      'organizationMembership.deleted',
    ],
  });
});

export default app;
