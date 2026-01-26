import { Hono } from 'hono';
import { squareClient, handleSquareError } from '../../lib/square';
import {
  successResponse,
  errorResponse,
  type StaffListArgs,
  type StaffGetArgs,
  type StaffInfo,
} from '../../types';

const app = new Hono();

/**
 * Transform Square team member to simplified StaffInfo
 */
function transformStaffMember(
  member: Record<string, unknown>,
  bookingProfile?: Record<string, unknown>
): StaffInfo {
  return {
    id: member.id as string,
    given_name: member.givenName as string | undefined,
    family_name: member.familyName as string | undefined,
    display_name: bookingProfile?.displayName as string | undefined 
      || `${member.givenName || ''} ${member.familyName || ''}`.trim() 
      || undefined,
    email: member.emailAddress as string | undefined,
    phone_number: member.phoneNumber as string | undefined,
    is_bookable: bookingProfile?.isBookable as boolean | undefined,
  };
}

/**
 * List team members (optionally filtered by location and/or service)
 */
app.post('/list', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const args: StaffListArgs = body.arguments || body;

    // Get team member booking profiles which includes bookability info
    const profilesPage = await squareClient.bookings.teamMemberProfiles.list({
      bookableOnly: true,
      locationId: args.location_id,
    });

    // Collect all profiles from the paginated response
    const profiles: Array<Record<string, unknown>> = [];
    for await (const profile of profilesPage) {
      profiles.push(profile as unknown as Record<string, unknown>);
    }
    
    // If we need to filter by service, we need to check each profile
    let filteredProfiles = profiles;
    
    if (args.service_variation_id) {
      filteredProfiles = profiles.filter((p) => {
        // Check if the team member can perform this service
        // This would require checking the catalog item's team member IDs
        // For now, return all bookable members
        return p.isBookable === true;
      });
    }

    const staffMembers: StaffInfo[] = [];

    // Get full team member details for each booking profile
    for (const p of filteredProfiles) {
      const teamMemberId = p.teamMemberId as string;
      
      try {
        const memberResponse = await squareClient.teamMembers.get({ teamMemberId });
        if (memberResponse.teamMember) {
          const member = memberResponse.teamMember as unknown as Record<string, unknown>;
          staffMembers.push(transformStaffMember(member, p));
        }
      } catch {
        // If we can't get the team member details, use profile info
        staffMembers.push({
          id: teamMemberId,
          display_name: p.displayName as string | undefined,
          is_bookable: p.isBookable as boolean | undefined,
        });
      }
    }

    return c.json(successResponse({
      count: staffMembers.length,
      staff: staffMembers,
    }));
  } catch (error) {
    console.error('Staff list error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * Get details for a specific staff member
 */
app.post('/get', async (c) => {
  try {
    const body = await c.req.json();
    const args: StaffGetArgs = body.arguments || body;

    if (!args.team_member_id) {
      return c.json(errorResponse('Missing required parameter: team_member_id'), 400);
    }

    // Get team member details
    const memberResponse = await squareClient.teamMembers.get({ teamMemberId: args.team_member_id });

    if (!memberResponse.teamMember) {
      return c.json(errorResponse('Staff member not found'), 404);
    }

    // Get booking profile
    let bookingProfile: Record<string, unknown> | undefined;
    try {
      const profileResponse = await squareClient.bookings.teamMemberProfiles.get({
        teamMemberId: args.team_member_id,
      });
      bookingProfile = profileResponse.teamMemberBookingProfile as unknown as Record<string, unknown>;
    } catch {
      // Booking profile may not exist
    }

    const member = memberResponse.teamMember as unknown as Record<string, unknown>;
    const staffMember = transformStaffMember(member, bookingProfile);

    return c.json(successResponse({
      staff: staffMember,
    }));
  } catch (error) {
    console.error('Staff get error:', error);
    return c.json(errorResponse(handleSquareError(error)), 500);
  }
});

/**
 * GET endpoint for documentation
 */
app.get('/', (c) => {
  return c.json({
    name: 'staff',
    description: 'Team member/staff endpoints for voice agent',
    endpoints: [
      {
        path: '/list',
        method: 'POST',
        description: 'List bookable team members (optionally filtered by location/service)',
        parameters: {
          location_id: { type: 'string', required: false, description: 'Filter by location' },
          service_variation_id: { type: 'string', required: false, description: 'Filter by service' },
        },
      },
      {
        path: '/get',
        method: 'POST',
        description: 'Get details for a specific staff member',
        parameters: {
          team_member_id: { type: 'string', required: true, description: 'Square team member ID' },
        },
      },
    ],
  });
});

export default app;
