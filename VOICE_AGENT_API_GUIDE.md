# HaloCall Voice Agent API Guide

Complete documentation for AI voice agents to book appointments using the HaloCall API. This guide covers the full booking workflow from customer identification to appointment confirmation.

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Response Format](#response-format)
4. [Booking Flow](#booking-flow)
5. [Endpoint Reference](#endpoint-reference)
6. [Common Scenarios](#common-scenarios)
7. [Error Handling](#error-handling)
8. [Best Practices](#best-practices)

---

## Overview

The HaloCall API enables AI voice agents to manage appointments for Square-powered businesses (spas, salons, wellness centers). All responses are optimized for text-to-speech (TTS) with human-readable dates, times, and durations.

**Base URL:** `https://halocall-production.up.railway.app`

**Key Concepts:**
- **Location**: A physical business location where services are provided
- **Service**: A bookable service (e.g., "Swedish Massage", "Haircut")
- **Service Variation**: A specific tier/option of a service (e.g., "60 minute", "90 minute")
- **Staff/Team Member**: A person who performs services
- **Customer**: The person booking the appointment
- **Availability**: Open time slots when a service can be booked

---

## Authentication

Every API request requires a `merchant_id` to identify which business account to use. Provide it in one of three ways:

### Option 1: Request Body (Recommended)
```json
{
  "merchant_id": "acme-salon",
  "phone_number": "+15551234567"
}
```

### Option 2: Query Parameter
```
POST /customers/lookup?merchant_id=acme-salon
```

### Option 3: Header
```
X-Merchant-ID: acme-salon
```

> **Important:** The `merchant_id` is configured when the business is onboarded. It is NOT the same as Square's merchant ID.

---

## Response Format

All endpoints return a consistent JSON structure:

### Success Response
```json
{
  "success": true,
  "data": {
    // Response data here
  }
}
```

### Error Response
```json
{
  "success": false,
  "error": "Human-readable error message"
}
```

### HTTP Status Codes
| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad Request - Missing or invalid parameters |
| 404 | Not Found - Resource doesn't exist |
| 500 | Server Error - Something went wrong |

---

## Booking Flow

Follow these steps to successfully book an appointment:

```
┌─────────────────────────────────────────────────────────────────┐
│                     APPOINTMENT BOOKING FLOW                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. IDENTIFY CUSTOMER                                           │
│     └─→ /customers/lookup (by caller's phone number)            │
│         └─→ If not found: /customers/create                     │
│                                                                  │
│  2. GATHER BUSINESS INFO (if needed)                            │
│     ├─→ /locations/list (get available locations)               │
│     ├─→ /services/list (get available services)                 │
│     └─→ /staff/list (get available staff - optional)            │
│                                                                  │
│  3. FIND AVAILABLE TIMES                                        │
│     └─→ /availability/search                                    │
│         Required: location_id, service_variation_id,            │
│                   start_date, end_date                          │
│                                                                  │
│  4. CREATE BOOKING                                              │
│     └─→ /bookings/create                                        │
│         Required: location_id, service_variation_id, start_at   │
│         Optional: customer_id, team_member_id, customer_note    │
│                                                                  │
│  5. CONFIRM TO CUSTOMER                                         │
│     └─→ Read booking details from response                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Step-by-Step Example

**Scenario:** A customer calls to book a massage at a spa.

#### Step 1: Identify the Customer

When a call comes in, look up the customer by their phone number:

```bash
POST /customers/lookup
{
  "merchant_id": "zen-spa",
  "phone_number": "+12065551234"
}
```

**If customer found:**
```json
{
  "success": true,
  "data": {
    "found": true,
    "customer": {
      "customer_id": "CUST_ABC123",
      "name": "Sarah Johnson",
      "email": "sarah@example.com",
      "phone_number": "+12065551234"
    }
  }
}
```

**If customer NOT found:**
```json
{
  "success": true,
  "data": {
    "found": false,
    "message": "No customer found with this phone number",
    "customer": null
  }
}
```

If not found, create a new customer:

```bash
POST /customers/create
{
  "merchant_id": "zen-spa",
  "given_name": "Sarah",
  "family_name": "Johnson",
  "phone_number": "+12065551234",
  "email": "sarah@example.com"
}
```

#### Step 2: Get Available Services

List the services this business offers:

```bash
POST /services/list
{
  "merchant_id": "zen-spa"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 4,
    "services": [
      {
        "service_id": "ITEM_MASSAGE",
        "variation_id": "VAR_MASSAGE_60",
        "service_name": "Swedish Massage",
        "variation_name": "60 Minutes",
        "description": "Relaxing full-body massage",
        "duration": "1 hour",
        "price": "$120.00"
      },
      {
        "service_id": "ITEM_MASSAGE",
        "variation_id": "VAR_MASSAGE_90",
        "service_name": "Swedish Massage",
        "variation_name": "90 Minutes",
        "duration": "1 hour 30 minutes",
        "price": "$160.00"
      },
      {
        "service_id": "ITEM_FACIAL",
        "variation_id": "VAR_FACIAL_BASIC",
        "service_name": "Signature Facial",
        "variation_name": "Basic",
        "duration": "45 minutes",
        "price": "$85.00"
      }
    ]
  }
}
```

> **Voice Agent Tip:** When the customer says "I'd like a massage", you can say:
> "We have Swedish Massage available in 60 minutes for $120 or 90 minutes for $160. Which would you prefer?"

#### Step 3: Get Location (if multiple)

```bash
POST /locations/list
{
  "merchant_id": "zen-spa"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 2,
    "locations": [
      {
        "location_id": "LOC_DOWNTOWN",
        "name": "Zen Spa Downtown",
        "address": "123 Main Street, Seattle, WA 98101",
        "phone_number": "+12065551000",
        "business_hours": "Monday through Friday 9:00 AM to 8:00 PM, Saturday and Sunday 10:00 AM to 6:00 PM"
      },
      {
        "location_id": "LOC_BELLEVUE",
        "name": "Zen Spa Bellevue",
        "address": "456 Bellevue Way, Bellevue, WA 98004",
        "phone_number": "+14255552000",
        "business_hours": "Open daily from 10:00 AM to 7:00 PM"
      }
    ]
  }
}
```

#### Step 4: Find Available Time Slots

Search for availability using the selected location and service:

```bash
POST /availability/search
{
  "merchant_id": "zen-spa",
  "location_id": "LOC_DOWNTOWN",
  "service_variation_id": "VAR_MASSAGE_60",
  "start_date": "2026-02-05",
  "end_date": "2026-02-07"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "Wednesday, February 5, 2026": ["10:00 AM", "11:00 AM", "2:00 PM", "3:00 PM", "4:00 PM"],
    "Thursday, February 6, 2026": ["9:00 AM", "10:00 AM", "1:00 PM", "2:00 PM"],
    "Friday, February 7, 2026": ["11:00 AM", "3:00 PM", "5:00 PM"]
  }
}
```

> **Voice Agent Tip:** Present availability naturally:
> "I have openings tomorrow at 10 AM, 11 AM, 2 PM, 3 PM, or 4 PM. Would any of those work for you?"

#### Step 5: Create the Booking

Once the customer chooses a time, create the booking:

```bash
POST /bookings/create
{
  "merchant_id": "zen-spa",
  "location_id": "LOC_DOWNTOWN",
  "service_variation_id": "VAR_MASSAGE_60",
  "start_at": "2026-02-05T14:00:00-08:00",
  "customer_id": "CUST_ABC123",
  "customer_note": "First time customer, prefers firm pressure"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Booking created successfully",
    "booking": {
      "booking_id": "BOOK_XYZ789",
      "status": "confirmed",
      "start_at": "2026-02-05T14:00:00-08:00",
      "appointment_time": "Wednesday, February 5 at 2:00 PM",
      "duration": "1 hour",
      "location_name": "Zen Spa Downtown",
      "customer_name": "Sarah Johnson",
      "service_name": "Swedish Massage",
      "customer_note": "First time customer, prefers firm pressure",
      "version": 0
    }
  }
}
```

> **Voice Agent Confirmation:**
> "Perfect! I've booked your 60-minute Swedish Massage for Wednesday, February 5th at 2 PM at our Downtown location. Is there anything else I can help you with?"

---

## Endpoint Reference

### Customer Endpoints

#### POST /customers/lookup
Look up a customer by phone number (typically the caller ID).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| phone_number | string | Yes | Phone number (any format) |

**Response:**
```json
{
  "success": true,
  "data": {
    "found": true,
    "customer": {
      "customer_id": "CUST_ABC123",
      "name": "Sarah Johnson",
      "email": "sarah@example.com",
      "phone_number": "+12065551234",
      "note": "Prefers morning appointments"
    }
  }
}
```

---

#### POST /customers/search
Search for customers by name, email, or phone (fuzzy matching).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| phone_number | string | No | Partial phone match |
| email | string | No | Partial email match |
| name | string | No | Name to search |
| limit | number | No | Max results (1-100) |

> At least one of `phone_number`, `email`, or `name` is required.

---

#### POST /customers/create
Create a new customer profile.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| given_name | string | No | First name |
| family_name | string | No | Last name |
| email | string | No | Email address |
| phone_number | string | No | Phone number |
| note | string | No | Notes about customer |

> At least one of `given_name`, `email`, or `phone_number` is required.

---

#### POST /customers/bookings
Get all bookings for a specific customer.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| customer_id | string | Yes | Square customer ID |
| location_id | string | No | Filter by location |
| limit | number | No | Max results |

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 2,
    "bookings": [
      {
        "booking_id": "BOOK_123",
        "status": "confirmed",
        "start_at": "2026-02-10T10:00:00-08:00",
        "appointment_time": "Monday, February 10 at 10:00 AM",
        "duration": "1 hour",
        "customer_note": "Regular customer",
        "version": 1
      }
    ]
  }
}
```

---

### Location Endpoints

#### POST /locations/list
List all active business locations.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 1,
    "locations": [
      {
        "location_id": "LOC_MAIN",
        "name": "Zen Spa Downtown",
        "address": "123 Main Street, Seattle, WA 98101",
        "phone_number": "+12065551000",
        "business_hours": "Monday through Friday 9:00 AM to 8:00 PM"
      }
    ]
  }
}
```

---

#### POST /locations/get
Get detailed information for a specific location.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | Yes | Square location ID |

---

### Service Endpoints

#### POST /services/list
List all bookable services.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | No | Filter by location |

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 3,
    "services": [
      {
        "service_id": "ITEM_ABC",
        "variation_id": "VAR_ABC_60",
        "service_name": "Swedish Massage",
        "variation_name": "60 Minutes",
        "description": "Full-body relaxation massage",
        "duration": "1 hour",
        "price": "$120.00"
      }
    ]
  }
}
```

> **Important:** Use `variation_id` (not `service_id`) for availability search and booking creation.

---

#### POST /services/get
Get details for a specific service.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| service_id | string | Yes | Square catalog item ID |

---

### Staff Endpoints

#### POST /staff/list
List bookable staff members.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | No | Filter by location |
| service_variation_id | string | No | Filter by service capability |

**Response:**
```json
{
  "success": true,
  "data": {
    "count": 3,
    "staff": [
      {
        "team_member_id": "TM_JANE",
        "name": "Jane Smith"
      },
      {
        "team_member_id": "TM_JOHN",
        "name": "John Doe"
      }
    ]
  }
}
```

---

#### POST /staff/get
Get details for a specific staff member.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| team_member_id | string | Yes | Square team member ID |

---

### Availability Endpoints

#### POST /availability/search
Search for available appointment time slots.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | Yes | Square location ID |
| service_variation_id | string | Yes | Service variation ID |
| start_date | string | Yes | Start date (YYYY-MM-DD) |
| end_date | string | Yes | End date (YYYY-MM-DD) |
| staff_member_ids | array | No | Filter by specific staff |

**Response:**
```json
{
  "success": true,
  "data": {
    "Wednesday, February 5, 2026": ["10:00 AM", "11:00 AM", "2:00 PM"],
    "Thursday, February 6, 2026": ["9:00 AM", "1:00 PM", "3:00 PM"]
  }
}
```

> **Tip:** Search a 3-7 day window initially. If no availability, expand the range.

---

### Booking Endpoints

#### POST /bookings/create
Create a new appointment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | Yes | Square location ID |
| service_variation_id | string | Yes | Service variation ID |
| start_at | string | Yes | Start time (RFC 3339 format) |
| customer_id | string | No | Customer ID (recommended) |
| team_member_id | string | No | Specific staff member |
| customer_note | string | No | Notes for the appointment |

**start_at Format Examples:**
- `2026-02-05T14:00:00Z` (UTC)
- `2026-02-05T14:00:00-08:00` (Pacific Time)
- `2026-02-05T14:00:00-05:00` (Eastern Time)

**Response:**
```json
{
  "success": true,
  "data": {
    "message": "Booking created successfully",
    "booking": {
      "booking_id": "BOOK_XYZ789",
      "status": "confirmed",
      "start_at": "2026-02-05T14:00:00-08:00",
      "appointment_time": "Wednesday, February 5 at 2:00 PM",
      "duration": "1 hour",
      "location_name": "Zen Spa Downtown",
      "customer_name": "Sarah Johnson",
      "staff_name": "Jane Smith",
      "service_name": "Swedish Massage",
      "customer_note": "First time customer",
      "version": 0
    }
  }
}
```

---

#### POST /bookings/get
Get details for a specific booking.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| booking_id | string | Yes | Square booking ID |

---

#### POST /bookings/update
Modify an existing booking (reschedule, change staff, add notes).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| booking_id | string | Yes | Square booking ID |
| booking_version | number | Yes | Current version (from GET) |
| start_at | string | No | New start time |
| team_member_id | string | No | New staff member |
| service_variation_id | string | No | New service |
| customer_note | string | No | Updated notes |

> **Critical:** Always include `booking_version` from the current booking to prevent conflicts.

**Example - Reschedule Appointment:**
```bash
POST /bookings/update
{
  "merchant_id": "zen-spa",
  "booking_id": "BOOK_XYZ789",
  "booking_version": 0,
  "start_at": "2026-02-06T15:00:00-08:00",
  "customer_note": "Rescheduled from Wednesday to Thursday"
}
```

---

#### POST /bookings/cancel
Cancel an appointment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| booking_id | string | Yes | Square booking ID |
| booking_version | number | No | Current version |
| cancel_reason | string | No | Reason for cancellation |

**Example:**
```bash
POST /bookings/cancel
{
  "merchant_id": "zen-spa",
  "booking_id": "BOOK_XYZ789",
  "cancel_reason": "Customer requested cancellation"
}
```

---

#### POST /bookings/list
List bookings with optional filters.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| merchant_id | string | Yes | Business identifier |
| location_id | string | No | Filter by location |
| customer_id | string | No | Filter by customer |
| team_member_id | string | No | Filter by staff |
| start_at_min | string | No | Start of date range |
| start_at_max | string | No | End of date range |
| limit | number | No | Max results |

**Response:**
```json
{
  "success": true,
  "data": {
    "total_count": 5,
    "upcoming_count": 3,
    "past_count": 2,
    "upcoming": [
      {
        "booking_id": "BOOK_123",
        "status": "confirmed",
        "appointment_time": "Monday, February 10 at 10:00 AM",
        "service_name": "Swedish Massage",
        "version": 1
      }
    ],
    "past": [
      {
        "booking_id": "BOOK_456",
        "status": "completed",
        "appointment_time": "Friday, January 31 at 2:00 PM",
        "service_name": "Deep Tissue Massage",
        "version": 2
      }
    ]
  }
}
```

---

## Common Scenarios

### Scenario 1: New Customer Booking

```
Customer: "Hi, I'd like to book a massage."
Agent: [Lookup fails - new customer]

1. /customers/lookup → not found
2. /services/list → present options
3. Customer chooses service
4. /locations/list → present locations (if multiple)
5. /availability/search → present times
6. Customer chooses time
7. /customers/create → create customer
8. /bookings/create → book appointment
9. Confirm to customer
```

### Scenario 2: Returning Customer Checking Appointments

```
Customer: "Do I have any upcoming appointments?"
Agent: [Lookup succeeds - returning customer]

1. /customers/lookup → found, get customer_id
2. /customers/bookings → list their bookings
3. Read back upcoming appointments
```

### Scenario 3: Reschedule Existing Appointment

```
Customer: "I need to reschedule my appointment on Wednesday."
Agent: [Find and reschedule]

1. /customers/lookup → get customer_id
2. /customers/bookings → find the Wednesday booking
3. /availability/search → find new times
4. Customer chooses new time
5. /bookings/update → reschedule (include booking_version!)
6. Confirm new time
```

### Scenario 4: Cancel Appointment

```
Customer: "I need to cancel my appointment."
Agent: [Find and cancel]

1. /customers/lookup → get customer_id
2. /customers/bookings → find the booking
3. Confirm which one to cancel
4. /bookings/cancel → cancel it
5. Confirm cancellation
```

### Scenario 5: Customer Wants Specific Staff Member

```
Customer: "Can I book with Sarah specifically?"
Agent: [Staff-specific booking]

1. /staff/list → find Sarah's team_member_id
2. /availability/search with staff_member_ids: ["TM_SARAH"]
3. Present Sarah's availability
4. /bookings/create with team_member_id
```

---

## Error Handling

### Common Errors and Responses

| Error | Cause | Voice Agent Response |
|-------|-------|---------------------|
| `Missing required parameter: location_id` | Parameter not provided | Check your request includes all required fields |
| `No customer found with this phone number` | Customer doesn't exist | Ask for name and create new customer |
| `Booking not found` | Invalid booking_id | Ask customer to clarify which appointment |
| `Service not found` | Invalid service_id | Re-fetch services list |
| `Version conflict` | Booking was modified | Re-fetch booking and retry with new version |

### Example Error Response
```json
{
  "success": false,
  "error": "Missing required parameter: service_variation_id"
}
```

### Handling No Availability

If `/availability/search` returns empty data:
```json
{
  "success": true,
  "data": {}
}
```

**Voice Agent Response:**
"I don't see any openings in that time frame. Would you like me to check the following week, or is there a different day that works better for you?"

---

## Best Practices

### 1. Always Identify the Customer First
Start every call by looking up the customer. This personalizes the experience and links bookings to their profile.

### 2. Use the variation_id, Not service_id
When searching availability and creating bookings, use `variation_id` from the services list:
```json
{
  "service_id": "ITEM_MASSAGE",      // ❌ Wrong - this is the parent item
  "variation_id": "VAR_MASSAGE_60"   // ✅ Correct - this is what you need
}
```

### 3. Search Reasonable Date Ranges
- Start with 3-7 days for availability search
- If no results, expand to 2 weeks
- Avoid searching more than 4 weeks at once

### 4. Include booking_version for Updates
Always get the current booking first and use its `version` field:
```json
{
  "booking_id": "BOOK_123",
  "booking_version": 2,    // From /bookings/get response
  "start_at": "2026-02-10T14:00:00Z"
}
```

### 5. Convert Times to RFC 3339 Format
The `/availability/search` returns human-readable times. For booking, construct RFC 3339:
- Input: "Wednesday, February 5, 2026" + "2:00 PM"
- Output: `2026-02-05T14:00:00-08:00`

### 6. Handle Single vs Multiple Locations
- If `locations.count === 1`: Skip asking about location, use that one
- If `locations.count > 1`: Ask customer which location they prefer

### 7. Confirm Before Creating
Always confirm the details before calling `/bookings/create`:
> "Just to confirm: You'd like a 60-minute Swedish Massage on Wednesday, February 5th at 2 PM at our Downtown location. Is that correct?"

### 8. Read Back Confirmation Details
After successful booking, read back key details from the response:
- Appointment date and time (`appointment_time`)
- Service name (`service_name`)
- Location (`location_name`)
- Duration (`duration`)

---

## Date/Time Format Reference

### Input Formats Accepted

| Format | Example | Use Case |
|--------|---------|----------|
| Date only | `2026-02-05` | availability search |
| RFC 3339 UTC | `2026-02-05T14:00:00Z` | booking creation |
| RFC 3339 with offset | `2026-02-05T14:00:00-08:00` | booking creation |

### Response Formats (TTS-Optimized)

| Field | Example |
|-------|---------|
| `appointment_time` | "Wednesday, February 5 at 2:00 PM" |
| `duration` | "1 hour 30 minutes" |
| `business_hours` | "Monday through Friday 9:00 AM to 5:00 PM" |
| `price` | "$120.00" |

---

## Quick Reference Card

### Booking an Appointment
```
1. POST /customers/lookup   → Get or create customer
2. POST /services/list      → What service?
3. POST /locations/list     → Which location? (if multiple)
4. POST /availability/search → When?
5. POST /bookings/create    → Book it!
```

### Managing Existing Bookings
```
POST /customers/bookings → See all bookings
POST /bookings/get       → Get booking details
POST /bookings/update    → Reschedule/modify
POST /bookings/cancel    → Cancel
```

### Required IDs to Collect
- `merchant_id` → Provided per business
- `location_id` → From /locations/list
- `variation_id` → From /services/list (NOT service_id!)
- `customer_id` → From /customers/lookup or /create
- `booking_id` → From /bookings/create or /list

---

## Related Documentation

- **[VOICE_AGENT_README.md](./VOICE_AGENT_README.md)** - Operational manual written as a system prompt for the AI voice agent. Contains step-by-step instructions, reliability guardrails, and exact call flows.
- **[README.md](./README.md)** - Technical setup, deployment, and cURL examples for developers.

---

## Support

For API issues or questions, contact the HaloCall team or check the main repository README for additional technical details.
