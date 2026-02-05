/**
 * Name Resolution Module
 * 
 * Converts human-readable names to Square IDs using fuzzy matching.
 * Enables voice agents to use natural language instead of opaque IDs.
 */

import { distance as levenshtein } from 'fastest-levenshtein';
import type { SquareClient } from 'square';
import type { ServiceInfo, StaffInfo, LocationInfo } from '../types';

// ============================================================================
// Types
// ============================================================================

export type MatchConfidence = 'exact' | 'fuzzy' | 'ambiguous' | 'none';

export interface ResolveResult<T> {
  match: T | null;
  confidence: MatchConfidence;
  alternatives?: T[];  // Populated when ambiguous
}

interface MatchScore<T> {
  item: T;
  score: number;
  matchType: 'exact' | 'contains' | 'fuzzy';
}

// ============================================================================
// Scoring Functions
// ============================================================================

/**
 * Normalize a string for comparison: lowercase, trim, collapse whitespace
 */
function normalize(str: string): string {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Calculate match score between query and target string.
 * Higher score = better match.
 * 
 * Scoring:
 * - Exact match: 100
 * - Contains (target contains query): 70-90 based on how much of target is matched
 * - Fuzzy (Levenshtein): 0-60 based on similarity ratio
 */
function calculateMatchScore(query: string, target: string): { score: number; matchType: 'exact' | 'contains' | 'fuzzy' } {
  const normalizedQuery = normalize(query);
  const normalizedTarget = normalize(target);
  
  // Exact match
  if (normalizedQuery === normalizedTarget) {
    return { score: 100, matchType: 'exact' };
  }
  
  // Contains match (target contains query)
  if (normalizedTarget.includes(normalizedQuery)) {
    // Score based on what percentage of target is matched
    const coverage = normalizedQuery.length / normalizedTarget.length;
    const score = 70 + (coverage * 20); // 70-90 range
    return { score, matchType: 'contains' };
  }
  
  // Check if query contains target (e.g., "60 min swedish massage" contains "swedish massage")
  if (normalizedQuery.includes(normalizedTarget)) {
    const coverage = normalizedTarget.length / normalizedQuery.length;
    const score = 65 + (coverage * 20); // 65-85 range
    return { score, matchType: 'contains' };
  }
  
  // Word overlap scoring
  const queryWords = normalizedQuery.split(' ');
  const targetWords = normalizedTarget.split(' ');
  const matchedWords = queryWords.filter(qw => 
    targetWords.some(tw => tw.includes(qw) || qw.includes(tw))
  );
  
  if (matchedWords.length > 0) {
    const wordOverlap = matchedWords.length / Math.max(queryWords.length, targetWords.length);
    if (wordOverlap >= 0.5) {
      return { score: 60 + (wordOverlap * 20), matchType: 'contains' };
    }
  }
  
  // Fuzzy match using Levenshtein distance
  const maxLen = Math.max(normalizedQuery.length, normalizedTarget.length);
  const dist = levenshtein(normalizedQuery, normalizedTarget);
  const similarity = 1 - (dist / maxLen);
  
  // Only consider fuzzy matches with > 60% similarity
  if (similarity >= 0.6) {
    const score = similarity * 60; // 0-60 range
    return { score, matchType: 'fuzzy' };
  }
  
  return { score: 0, matchType: 'fuzzy' };
}

/**
 * Find best matches from a list of items using a name extractor
 */
function findBestMatches<T>(
  query: string,
  items: T[],
  getNames: (item: T) => string[],
  threshold = 50
): MatchScore<T>[] {
  const scores: MatchScore<T>[] = [];
  
  for (const item of items) {
    const names = getNames(item);
    let bestScore = 0;
    let bestMatchType: 'exact' | 'contains' | 'fuzzy' = 'fuzzy';
    
    for (const name of names) {
      const result = calculateMatchScore(query, name);
      if (result.score > bestScore) {
        bestScore = result.score;
        bestMatchType = result.matchType;
      }
    }
    
    if (bestScore >= threshold) {
      scores.push({ item, score: bestScore, matchType: bestMatchType });
    }
  }
  
  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  
  return scores;
}

/**
 * Determine result from match scores
 */
function determineResult<T>(scores: MatchScore<T>[]): ResolveResult<T> {
  if (scores.length === 0) {
    return { match: null, confidence: 'none' };
  }
  
  const topScore = scores[0];
  
  // Exact match - unambiguous
  if (topScore.matchType === 'exact') {
    return { match: topScore.item, confidence: 'exact' };
  }
  
  // Check for ambiguity: multiple high scores within 10 points of top
  const closeMatches = scores.filter(s => topScore.score - s.score <= 10);
  
  if (closeMatches.length > 1) {
    return {
      match: null,
      confidence: 'ambiguous',
      alternatives: closeMatches.map(s => s.item),
    };
  }
  
  // Single clear winner with fuzzy/contains match
  return { match: topScore.item, confidence: 'fuzzy' };
}

// ============================================================================
// Service Resolution
// ============================================================================

/**
 * Fetch all services from Square catalog
 */
async function fetchServices(squareClient: SquareClient): Promise<ServiceInfo[]> {
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

    for (const variation of variations) {
      const variationData = variation.itemVariationData as Record<string, unknown> | undefined;
      const priceMoney = variationData?.priceMoney as Record<string, unknown> | undefined;
      
      const serviceName = (itemData?.name as string | undefined) || 'Unknown Service';
      const variationName = variationData?.name as string | undefined;
      
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
      
      let price: string | undefined;
      if (priceMoney) {
        const amount = Number(priceMoney.amount) / 100;
        price = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: priceMoney.currency as string,
        }).format(amount);
      }
      
      services.push({
        service_id: itemRecord.id as string,
        variation_id: variation.id as string,
        service_name: serviceName,
        variation_name: variationName,
        description: itemData?.description as string | undefined,
        duration,
        price,
      });
    }
  }

  return services;
}

/**
 * Resolve a service name to a ServiceInfo with variation_id
 */
export async function resolveServiceName(
  squareClient: SquareClient,
  serviceName: string,
  _locationId?: string // For future location-specific filtering
): Promise<ResolveResult<ServiceInfo>> {
  const services = await fetchServices(squareClient);
  
  // Build searchable names for each service
  const getNames = (service: ServiceInfo): string[] => {
    const names = [service.service_name];
    
    if (service.variation_name) {
      names.push(`${service.service_name} ${service.variation_name}`);
      names.push(service.variation_name);
    }
    
    if (service.duration) {
      names.push(`${service.service_name} ${service.duration}`);
      if (service.variation_name) {
        names.push(`${service.variation_name} ${service.duration}`);
      }
    }
    
    return names;
  };
  
  const matches = findBestMatches(serviceName, services, getNames);
  return determineResult(matches);
}

/**
 * Get all services (for listing)
 */
export async function listServices(squareClient: SquareClient): Promise<ServiceInfo[]> {
  return fetchServices(squareClient);
}

// ============================================================================
// Staff Resolution
// ============================================================================

/**
 * Fetch all bookable staff members
 */
async function fetchStaff(
  squareClient: SquareClient,
  locationId?: string
): Promise<StaffInfo[]> {
  const profilesPage = await squareClient.bookings.teamMemberProfiles.list({
    bookableOnly: true,
    locationId,
  });

  const staffMembers: StaffInfo[] = [];

  for await (const profile of profilesPage) {
    const p = profile as unknown as Record<string, unknown>;
    const teamMemberId = p.teamMemberId as string;
    const displayName = p.displayName as string | undefined;
    
    // Try to get full name from team member details
    let name = displayName;
    if (!name) {
      try {
        const memberResponse = await squareClient.teamMembers.get({ teamMemberId });
        const member = memberResponse.teamMember as unknown as Record<string, unknown>;
        const givenName = member?.givenName as string | undefined;
        const familyName = member?.familyName as string | undefined;
        name = [givenName, familyName].filter(Boolean).join(' ') || 'Unknown';
      } catch {
        name = 'Unknown';
      }
    }
    
    staffMembers.push({
      team_member_id: teamMemberId,
      name,
    });
  }

  return staffMembers;
}

/**
 * Resolve a staff name to a StaffInfo with team_member_id
 */
export async function resolveStaffName(
  squareClient: SquareClient,
  staffName: string,
  locationId?: string
): Promise<ResolveResult<StaffInfo>> {
  const staff = await fetchStaff(squareClient, locationId);
  
  const getNames = (member: StaffInfo): string[] => {
    const names = [member.name];
    
    // Also match first name only
    const firstName = member.name.split(' ')[0];
    if (firstName && firstName !== member.name) {
      names.push(firstName);
    }
    
    return names;
  };
  
  const matches = findBestMatches(staffName, staff, getNames);
  return determineResult(matches);
}

/**
 * Get all staff members (for listing)
 */
export async function listStaff(
  squareClient: SquareClient,
  locationId?: string
): Promise<StaffInfo[]> {
  return fetchStaff(squareClient, locationId);
}

// ============================================================================
// Location Resolution
// ============================================================================

/**
 * Fetch all active locations
 */
async function fetchLocations(squareClient: SquareClient): Promise<LocationInfo[]> {
  const response = await squareClient.locations.list();
  
  const locations = (response.locations || [])
    .filter((loc) => (loc as unknown as Record<string, unknown>).status === 'ACTIVE')
    .map((loc) => {
      const l = loc as unknown as Record<string, unknown>;
      const address = l.address as Record<string, unknown> | undefined;
      
      const addressParts = [
        address?.addressLine1 as string,
        address?.locality as string,
        address?.administrativeDistrictLevel1 as string,
        address?.postalCode as string,
      ].filter(Boolean);
      
      return {
        location_id: l.id as string,
        name: l.name as string,
        address: addressParts.length > 0 ? addressParts.join(', ') : undefined,
        phone_number: l.phoneNumber as string | undefined,
        timezone: l.timezone as string | undefined,
      };
    });

  return locations;
}

/**
 * Resolve a location name to a LocationInfo with location_id
 */
export async function resolveLocationName(
  squareClient: SquareClient,
  locationName: string
): Promise<ResolveResult<LocationInfo>> {
  const locations = await fetchLocations(squareClient);
  
  const getNames = (location: LocationInfo): string[] => {
    const names = [location.name];
    
    // Also match parts of address
    if (location.address) {
      names.push(location.address);
      // Add individual address components
      const parts = location.address.split(',').map(p => p.trim());
      names.push(...parts);
    }
    
    return names;
  };
  
  const matches = findBestMatches(locationName, locations, getNames);
  return determineResult(matches);
}

/**
 * Get all locations (for listing)
 */
export async function listLocations(squareClient: SquareClient): Promise<LocationInfo[]> {
  return fetchLocations(squareClient);
}

/**
 * Get a single location by ID with timezone
 */
export async function getLocation(
  squareClient: SquareClient,
  locationId: string
): Promise<LocationInfo & { timezone: string }> {
  const response = await squareClient.locations.get({ locationId });
  const loc = response.location as unknown as Record<string, unknown>;
  const address = loc.address as Record<string, unknown> | undefined;
  
  const addressParts = [
    address?.addressLine1 as string,
    address?.locality as string,
    address?.administrativeDistrictLevel1 as string,
    address?.postalCode as string,
  ].filter(Boolean);
  
  return {
    location_id: loc.id as string,
    name: loc.name as string,
    address: addressParts.length > 0 ? addressParts.join(', ') : undefined,
    phone_number: loc.phoneNumber as string | undefined,
    timezone: (loc.timezone as string) || 'America/Los_Angeles',
  };
}

// ============================================================================
// Utility: Format display name for services
// ============================================================================

/**
 * Get a display name for a service suitable for voice output
 */
export function getServiceDisplayName(service: ServiceInfo): string {
  if (service.variation_name && service.variation_name !== service.service_name) {
    return `${service.service_name} (${service.variation_name})`;
  }
  return service.service_name;
}
