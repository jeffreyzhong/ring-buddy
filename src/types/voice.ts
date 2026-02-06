/**
 * Type definitions for Voice Agent endpoints
 * 
 * These endpoints accept human-readable names instead of Square IDs,
 * enabling natural language interaction from voice agents.
 */

// ============================================================================
// Request Types (Name-Based)
// ============================================================================

/** POST /voice/services - List all services */
export interface VoiceServicesArgs {
  // No parameters required
}

/** POST /voice/staff - List staff members */
export interface VoiceStaffArgs {
  /** Optional: filter by service name */
  service_name?: string;
  /** Optional: filter by location name */
  location_name?: string;
}

/** POST /voice/locations - List all locations */
export interface VoiceLocationsArgs {
  // No parameters required
}

/** POST /voice/availability - Search available times */
export interface VoiceAvailabilityArgs {
  /** Service name (e.g., "Swedish massage", "60 minute massage") */
  service_name: string;
  /** Optional: staff member name (e.g., "Sarah", "anyone") */
  staff_name?: string;
  /** Optional: location name (e.g., "Downtown", "Main Street") */
  location_name?: string;
  /** When to look for appointments (e.g., "tomorrow", "next Tuesday", "Thursday afternoon") */
  date_preference: string;
}

/** POST /voice/book - Create a booking */
export interface VoiceBookArgs {
  /** Service name */
  service_name: string;
  /** Specific time (e.g., "tomorrow at 2pm", "Thursday at 10:30am") */
  time: string;
  /** Staff member name, or "anyone" if no preference */
  staff_name: string;
  /** Optional: location name */
  location_name?: string;
  /** Optional: customer phone number (for new customers or identification) */
  customer_phone?: string;
  /** Optional: customer ID if already known */
  customer_id?: string;
  /** Optional: notes for the appointment */
  notes?: string;
}

/** POST /voice/customer - Lookup customer by phone */
export interface VoiceCustomerLookupArgs {
  /** Phone number in any format */
  phone: string;
}

/** POST /voice/customer/create - Create new customer */
export interface VoiceCustomerCreateArgs {
  /** First name */
  first_name: string;
  /** Optional: last name */
  last_name?: string;
  /** Phone number */
  phone: string;
  /** Optional: email address */
  email?: string;
}

/** POST /voice/appointments - Get customer's appointments */
export interface VoiceAppointmentsArgs {
  /** Phone number to look up customer */
  phone: string;
}

/** POST /voice/reschedule - Reschedule an appointment */
export interface VoiceRescheduleArgs {
  /** Description of current appointment (e.g., "my massage tomorrow", "the 2pm on Thursday") */
  current_appointment: string;
  /** New time (e.g., "Friday at 3pm") */
  new_time: string;
  /** Optional: customer phone for identification */
  phone?: string;
}

/** POST /voice/cancel - Cancel an appointment */
export interface VoiceCancelArgs {
  /** Description of appointment to cancel (e.g., "my massage tomorrow") */
  appointment: string;
  /** Optional: reason for cancellation */
  reason?: string;
  /** Optional: customer phone for identification */
  phone?: string;
}

// ============================================================================
// Response Types (Voice-Optimized)
// ============================================================================

/** Service info formatted for voice */
export interface VoiceServiceInfo {
  /** Display name (e.g., "Swedish Massage (60 minutes)") */
  name: string;
  /** Duration (e.g., "1 hour") */
  duration?: string;
  /** Price (e.g., "$120") */
  price?: string;
  /** Description if available */
  description?: string;
}

/** Staff info formatted for voice */
export interface VoiceStaffInfo {
  /** Staff member name */
  name: string;
}

/** Location info formatted for voice */
export interface VoiceLocationInfo {
  /** Location name */
  name: string;
  /** Address */
  address?: string;
  /** Business hours (formatted for speech) */
  hours?: string;
  /** Phone number */
  phone?: string;
}

/** Availability formatted for voice */
export interface VoiceAvailabilityResponse {
  /** Available dates with time slots */
  availability: Record<string, string[]>;
  /** Service being searched */
  service_name: string;
  /** Location name */
  location_name: string;
  /** Staff name if specified */
  staff_name?: string;
  /** Summary for voice (e.g., "I found 5 openings on Tuesday and 3 on Wednesday") */
  summary: string;
}

/** Booking confirmation formatted for voice */
export interface VoiceBookingConfirmation {
  /** Confirmation/booking ID */
  confirmation_id: string;
  /** Human-readable appointment time */
  appointment_time: string;
  /** Service name */
  service_name: string;
  /** Location name */
  location_name: string;
  /** Staff name if assigned */
  staff_name?: string;
  /** Duration */
  duration?: string;
  /** Summary sentence for TTS */
  summary: string;
}

/** Customer lookup result */
export interface VoiceCustomerResult {
  /** Whether customer was found */
  found: boolean;
  /** Customer name if found */
  name?: string;
  /** Customer ID for booking */
  customer_id?: string;
  /** Message for voice agent */
  message: string;
}

/** Appointment list result */
export interface VoiceAppointmentInfo {
  /** Booking ID */
  booking_id: string;
  /** Human-readable time */
  appointment_time: string;
  /** Service name */
  service_name?: string;
  /** Location name */
  location_name?: string;
  /** Staff name */
  staff_name?: string;
  /** Status (confirmed, cancelled, etc.) */
  status: string;
  /** Version for updates */
  version: number;
}

/** Appointments list response */
export interface VoiceAppointmentsResponse {
  /** Customer name */
  customer_name: string;
  /** Number of upcoming appointments */
  upcoming_count: number;
  /** Upcoming appointments */
  upcoming: VoiceAppointmentInfo[];
  /** Summary for voice */
  summary: string;
}

/** Reschedule/cancel result */
export interface VoiceModifyResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** New appointment details (for reschedule) */
  new_time?: string;
  /** Message for voice agent */
  message: string;
}
