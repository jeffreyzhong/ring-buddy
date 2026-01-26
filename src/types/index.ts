/**
 * Standard webhook response format for AI voice agent tool calls
 */
export interface WebhookResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Common request body structure from voice agent
 */
export interface WebhookRequest<T = Record<string, unknown>> {
  /** Unique identifier for this tool call */
  call_id?: string;
  /** The tool/function being invoked */
  tool_name?: string;
  /** Arguments passed to the tool */
  arguments?: T;
  /** Additional metadata from the voice agent */
  metadata?: Record<string, unknown>;
}

/**
 * Helper to create a successful response
 */
export function successResponse<T>(data: T): WebhookResponse<T> {
  return {
    success: true,
    data,
  };
}

/**
 * Helper to create an error response
 */
export function errorResponse(error: string): WebhookResponse {
  return {
    success: false,
    error,
  };
}

// ============================================================================
// Customer Endpoint Types
// ============================================================================

export interface CustomerLookupArgs {
  /** Phone number to look up (E.164 format preferred, e.g., +12065551234) */
  phone_number: string;
}

export interface CustomerSearchArgs {
  /** Search by phone number */
  phone_number?: string;
  /** Search by email address */
  email?: string;
  /** Search by name (given name, family name) */
  name?: string;
  /** Maximum results to return (1-100, default 10) */
  limit?: number;
}

export interface CustomerCreateArgs {
  /** Customer's first name */
  given_name?: string;
  /** Customer's last name */
  family_name?: string;
  /** Customer's email address */
  email?: string;
  /** Customer's phone number (E.164 format preferred) */
  phone_number?: string;
  /** Optional note about the customer */
  note?: string;
}

export interface CustomerBookingsArgs {
  /** Square customer ID */
  customer_id: string;
  /** Filter by location ID */
  location_id?: string;
  /** Maximum results to return */
  limit?: number;
}

// ============================================================================
// Location Endpoint Types
// ============================================================================

export interface LocationListArgs {
  /** No arguments required - lists all locations */
}

export interface LocationGetArgs {
  /** Square location ID */
  location_id: string;
}

// ============================================================================
// Service Endpoint Types
// ============================================================================

export interface ServiceListArgs {
  /** Filter services by location ID */
  location_id?: string;
}

export interface ServiceGetArgs {
  /** Square catalog item ID for the service */
  service_id: string;
}

// ============================================================================
// Staff Endpoint Types
// ============================================================================

export interface StaffListArgs {
  /** Filter by location ID */
  location_id?: string;
  /** Filter by service variation ID (only staff who can perform this service) */
  service_variation_id?: string;
  /** Include booking profile details */
  include_booking_profile?: boolean;
}

export interface StaffGetArgs {
  /** Square team member ID */
  team_member_id: string;
}

// ============================================================================
// Availability Endpoint Types
// ============================================================================

export interface AvailabilitySearchArgs {
  /** Location ID (required) */
  location_id: string;
  /** Service variation ID (required) */
  service_variation_id: string;
  /** Start date for availability search (YYYY-MM-DD format) */
  start_date: string;
  /** End date for availability search (YYYY-MM-DD format) */
  end_date: string;
  /** Filter by specific staff member IDs */
  staff_member_ids?: string[];
}

// ============================================================================
// Booking Endpoint Types
// ============================================================================

export interface BookingCreateArgs {
  /** Location ID */
  location_id: string;
  /** Customer ID (optional - can create booking without customer) */
  customer_id?: string;
  /** Customer's name if no customer_id provided */
  customer_name?: string;
  /** Customer's phone if no customer_id provided */
  customer_phone?: string;
  /** Customer's email if no customer_id provided */
  customer_email?: string;
  /** Service variation ID */
  service_variation_id: string;
  /** Team member ID (optional) */
  team_member_id?: string;
  /** Start time in RFC 3339 format (e.g., 2024-01-15T14:00:00Z) */
  start_at: string;
  /** Optional note for the booking */
  customer_note?: string;
}

export interface BookingGetArgs {
  /** Square booking ID */
  booking_id: string;
}

export interface BookingUpdateArgs {
  /** Square booking ID */
  booking_id: string;
  /** New start time in RFC 3339 format */
  start_at?: string;
  /** New team member ID */
  team_member_id?: string;
  /** New service variation ID */
  service_variation_id?: string;
  /** Updated customer note */
  customer_note?: string;
  /** Current booking version (required for updates) */
  booking_version: number;
}

export interface BookingCancelArgs {
  /** Square booking ID */
  booking_id: string;
  /** Current booking version (optional) */
  booking_version?: number;
  /** Cancellation reason */
  cancel_reason?: string;
}

export interface BookingListArgs {
  /** Filter by location ID */
  location_id?: string;
  /** Filter by customer ID */
  customer_id?: string;
  /** Filter by team member ID */
  team_member_id?: string;
  /** Start of date range (YYYY-MM-DD or RFC 3339) */
  start_at_min?: string;
  /** End of date range (YYYY-MM-DD or RFC 3339) */
  start_at_max?: string;
  /** Maximum results to return */
  limit?: number;
}

// ============================================================================
// Simplified Response Types for Voice Agent
// ============================================================================

/** Simplified customer info for voice agent */
export interface CustomerInfo {
  id: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  phone_number?: string;
  note?: string;
  created_at?: string;
}

/** Simplified location info for voice agent */
export interface LocationInfo {
  id: string;
  name: string;
  address?: {
    address_line_1?: string;
    locality?: string;
    administrative_district_level_1?: string;
    postal_code?: string;
  };
  phone_number?: string;
  business_hours?: Array<{
    day_of_week: string;
    start_local_time: string;
    end_local_time: string;
  }>;
  timezone?: string;
}

/** Simplified service info for voice agent */
export interface ServiceInfo {
  id: string;
  variation_id: string;
  name: string;
  description?: string;
  duration_minutes?: number;
  price?: {
    amount: number;
    currency: string;
  };
}

/** Simplified staff info for voice agent */
export interface StaffInfo {
  id: string;
  given_name?: string;
  family_name?: string;
  display_name?: string;
  email?: string;
  phone_number?: string;
  is_bookable?: boolean;
}

/** Simplified availability slot for voice agent */
export interface AvailabilitySlot {
  start_at: string;
  location_id: string;
  team_member_id?: string;
  service_variation_id: string;
  /** Human-readable time, e.g., "Tuesday, January 15 at 2:00 PM" */
  formatted_time?: string;
}

/** Simplified booking info for voice agent */
export interface BookingInfo {
  id: string;
  status: string;
  start_at: string;
  /** Human-readable time */
  formatted_time?: string;
  duration_minutes?: number;
  location_id: string;
  location_name?: string;
  customer_id?: string;
  customer_name?: string;
  team_member_id?: string;
  team_member_name?: string;
  service_name?: string;
  customer_note?: string;
  version: number;
}
