/**
 * Natural Language Date/Time Parser
 * 
 * Parses human-readable date/time expressions into RFC 3339 format for Square API.
 * Uses chrono-node for natural language understanding.
 */

import * as chrono from 'chrono-node';

// ============================================================================
// Types
// ============================================================================

export interface ParsedDateTime {
  /** RFC 3339 timestamp for exact times */
  startAt?: string;
  /** Human-readable representation for confirmation */
  humanReadable: string;
  /** Whether this is a range (e.g., "tomorrow") vs specific time (e.g., "tomorrow at 2pm") */
  isRange: boolean;
  /** Start of search window (for availability searches) */
  rangeStart: string;
  /** End of search window (for availability searches) */
  rangeEnd: string;
}

export interface ParseOptions {
  /** Timezone for interpreting times (e.g., "America/Los_Angeles") */
  timezone: string;
  /** Reference date for relative expressions (defaults to now) */
  referenceDate?: Date;
  /** Default search window in days when no end date specified */
  defaultRangeDays?: number;
}

// ============================================================================
// Time Period Definitions
// ============================================================================

interface TimePeriod {
  startHour: number;
  endHour: number;
}

const TIME_PERIODS: Record<string, TimePeriod> = {
  'morning': { startHour: 8, endHour: 12 },
  'afternoon': { startHour: 12, endHour: 17 },
  'evening': { startHour: 17, endHour: 21 },
  'night': { startHour: 18, endHour: 22 },
};

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get current date in a specific timezone
 */
function getNowInTimezone(timezone: string): Date {
  const now = new Date();
  // Create a date string in the target timezone and parse it back
  const tzString = now.toLocaleString('en-US', { timeZone: timezone });
  return new Date(tzString);
}

/**
 * Format a date to RFC 3339 with timezone offset
 */
function toRFC3339(date: Date, timezone: string): string {
  // Get timezone offset
  const tzDate = new Date(date.toLocaleString('en-US', { timeZone: timezone }));
  const utcDate = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = tzDate.getTime() - utcDate.getTime();
  const offsetHours = Math.floor(Math.abs(offsetMs) / (1000 * 60 * 60));
  const offsetMinutes = Math.floor((Math.abs(offsetMs) % (1000 * 60 * 60)) / (1000 * 60));
  const offsetSign = offsetMs >= 0 ? '+' : '-';
  const offsetString = `${offsetSign}${String(offsetHours).padStart(2, '0')}:${String(offsetMinutes).padStart(2, '0')}`;
  
  // Format the date
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetString}`;
}

/**
 * Format a date to YYYY-MM-DD
 */
function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format date for human-readable output
 */
function formatHumanReadable(date: Date, includeTime: boolean): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  };
  
  if (includeTime) {
    options.hour = 'numeric';
    options.minute = '2-digit';
  }
  
  return date.toLocaleString('en-US', options);
}

/**
 * Check if a time period keyword is present in the input
 */
function detectTimePeriod(input: string): TimePeriod | null {
  const lowerInput = input.toLowerCase();
  
  for (const [period, times] of Object.entries(TIME_PERIODS)) {
    if (lowerInput.includes(period)) {
      return times;
    }
  }
  
  return null;
}

/**
 * Set time on a date object
 */
function setTime(date: Date, hours: number, minutes = 0, seconds = 0): Date {
  const result = new Date(date);
  result.setHours(hours, minutes, seconds, 0);
  return result;
}

/**
 * Add days to a date
 */
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// ============================================================================
// Main Parser
// ============================================================================

/**
 * Parse natural language date/time into structured format for Square API
 * 
 * @param input - Natural language input (e.g., "tomorrow at 2pm", "next Tuesday", "Thursday afternoon")
 * @param options - Parsing options including timezone
 * @returns Parsed date/time with RFC 3339 timestamps
 * 
 * @example
 * // Specific time
 * parseNaturalDateTime("tomorrow at 2pm", { timezone: "America/Los_Angeles" })
 * // Returns: { startAt: "2026-02-05T14:00:00-08:00", isRange: false, ... }
 * 
 * @example
 * // Date range
 * parseNaturalDateTime("next Tuesday", { timezone: "America/Los_Angeles" })
 * // Returns: { isRange: true, rangeStart: "2026-02-10T00:00:00-08:00", rangeEnd: "2026-02-10T23:59:59-08:00", ... }
 * 
 * @example
 * // Time period
 * parseNaturalDateTime("Thursday afternoon", { timezone: "America/Los_Angeles" })
 * // Returns: { isRange: true, rangeStart: "2026-02-06T12:00:00-08:00", rangeEnd: "2026-02-06T17:00:00-08:00", ... }
 */
export function parseNaturalDateTime(
  input: string,
  options: ParseOptions
): ParsedDateTime {
  const { timezone, referenceDate, defaultRangeDays = 7 } = options;
  const now = referenceDate || getNowInTimezone(timezone);
  
  // Check for time period keywords (morning, afternoon, evening)
  const timePeriod = detectTimePeriod(input);
  
  // Use chrono to parse the date/time
  const results = chrono.parse(input, now, { forwardDate: true });
  
  if (results.length === 0) {
    // No date found - default to next 7 days
    const rangeStart = setTime(now, 0, 0, 0);
    const rangeEnd = setTime(addDays(now, defaultRangeDays), 23, 59, 59);
    
    return {
      humanReadable: `next ${defaultRangeDays} days`,
      isRange: true,
      rangeStart: toRFC3339(rangeStart, timezone),
      rangeEnd: toRFC3339(rangeEnd, timezone),
    };
  }
  
  const parsed = results[0];
  const parsedDate = parsed.start.date();
  
  // Check if a specific time was mentioned
  const hasTime = parsed.start.isCertain('hour');
  
  if (hasTime && !timePeriod) {
    // Specific time mentioned - this is an exact booking time
    return {
      startAt: toRFC3339(parsedDate, timezone),
      humanReadable: formatHumanReadable(parsedDate, true),
      isRange: false,
      rangeStart: toRFC3339(parsedDate, timezone),
      rangeEnd: toRFC3339(parsedDate, timezone),
    };
  }
  
  // Date only or date + time period - create a range
  let rangeStart: Date;
  let rangeEnd: Date;
  
  if (timePeriod) {
    // Time period specified (morning, afternoon, evening)
    rangeStart = setTime(parsedDate, timePeriod.startHour, 0, 0);
    rangeEnd = setTime(parsedDate, timePeriod.endHour, 0, 0);
  } else {
    // Just a date - use business hours (8am to 9pm)
    rangeStart = setTime(parsedDate, 8, 0, 0);
    rangeEnd = setTime(parsedDate, 21, 0, 0);
  }
  
  // Handle "this week", "next week" type expressions
  if (parsed.end) {
    const endDate = parsed.end.date();
    rangeEnd = setTime(endDate, 21, 0, 0);
  }
  
  return {
    humanReadable: formatHumanReadable(parsedDate, false) + (timePeriod ? ` ${Object.keys(TIME_PERIODS).find(k => TIME_PERIODS[k] === timePeriod)}` : ''),
    isRange: true,
    rangeStart: toRFC3339(rangeStart, timezone),
    rangeEnd: toRFC3339(rangeEnd, timezone),
  };
}

/**
 * Parse a specific booking time (must be exact, not a range)
 * Returns null if the input is ambiguous
 */
export function parseBookingTime(
  input: string,
  options: ParseOptions
): string | null {
  const result = parseNaturalDateTime(input, options);
  
  if (result.isRange) {
    return null; // Ambiguous - need specific time
  }
  
  return result.startAt || null;
}

/**
 * Parse a date range for availability search
 */
export function parseAvailabilityRange(
  input: string,
  options: ParseOptions
): { startDate: string; endDate: string; humanReadable: string } {
  const result = parseNaturalDateTime(input, options);
  
  // Extract just the date portion
  const startDate = result.rangeStart.split('T')[0];
  const endDate = result.rangeEnd.split('T')[0];
  
  return {
    startDate,
    endDate,
    humanReadable: result.humanReadable,
  };
}

/**
 * Format a date/time for voice output (TTS-optimized)
 */
export function formatForVoice(isoDate: string, timezone?: string): string {
  const date = new Date(isoDate);
  
  return date.toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone,
  });
}
