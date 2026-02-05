# ElevenLabs Voice Agent Setup Guide

This guide covers setting up ElevenLabs voice agents with HaloCall's name-based API endpoints.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    ElevenLabs Workspace                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Workspace-Level Tools                       │   │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐     │   │
│  │  │list_services │ │check_avail.  │ │book_appoint. │ ... │   │
│  │  └──────────────┘ └──────────────┘ └──────────────┘     │   │
│  └────────────────────────┬────────────────────────────────┘   │
│                           │ attached to                         │
│  ┌────────────────────────▼────────────────────────────────┐   │
│  │                     Agents                               │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │  Merchant A  │  │  Merchant B  │  │  Merchant C  │   │   │
│  │  │ secret header│  │ secret header│  │ secret header│   │   │
│  │  │ X-Merchant-ID│  │ X-Merchant-ID│  │ X-Merchant-ID│   │   │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │   │
│  └─────────┼─────────────────┼─────────────────┼───────────┘   │
└────────────┼─────────────────┼─────────────────┼───────────────┘
             │                 │                 │
             ▼                 ▼                 ▼
     ┌───────────────────────────────────────────────────┐
     │              HaloCall API                          │
     │  /voice/* endpoints (name-based parameters)        │
     │    → Name resolution (fuzzy matching)              │
     │    → Date parsing (natural language)               │
     │    → Multi-tenant via X-Merchant-ID header         │
     └───────────────────────────────────────────────────┘
             │
             ▼
     ┌───────────────────────────────────────────────────┐
     │              Square Bookings API                   │
     └───────────────────────────────────────────────────┘
```

## Prerequisites

1. **HaloCall Backend Deployed** - The API must be accessible via HTTPS
2. **Merchant Configured** - Run `bun run scripts/add-merchant.ts` to add a merchant
3. **ElevenLabs Account** - With API access enabled

## Step 1: Provision Tools

### Option A: Automated (Recommended)

Use the provided script to create all tools via the ElevenLabs API:

```bash
# Set your API key
export ELEVENLABS_API_KEY=your_api_key_here

# Preview what will be created
bun run scripts/create-elevenlabs-tools.ts --dry-run

# Create the tools
bun run scripts/create-elevenlabs-tools.ts

# Use custom base URL if needed
bun run scripts/create-elevenlabs-tools.ts --base-url=https://your-custom-url.com
```

### Option B: Manual Setup

Create each tool manually in the ElevenLabs dashboard:

1. Go to **Agents** → **Tools** → **Create Tool**
2. Select **Webhook** as the tool type
3. Configure each tool using the specifications below

## Step 2: Create a Merchant Agent

1. Go to **Agents** → **Create Agent**
2. Configure the agent's voice, personality, and first message
3. Attach the HaloCall tools to the agent
4. **Critical**: Add the merchant ID header to each tool

### Adding Required Headers

For each tool attached to the agent, you need to configure two secret headers:

#### 1. Merchant ID Header

1. Click on the tool → **Edit**
2. Go to **Headers**
3. Add a new header:
   - **Key**: `X-Merchant-ID`
   - **Value**: Your merchant's ID (from HaloCall)
   - **Secret**: ✓ Enable (hides from LLM)

#### 2. Webhook Secret Header (Authentication)

1. In the same Headers section, add another header:
   - **Key**: `X-ElevenLabs-Secret`
   - **Value**: Your webhook secret (from `ELEVENLABS_WEBHOOK_SECRET` env var)
   - **Secret**: ✓ Enable (hides from LLM)

This header authenticates webhook calls from ElevenLabs to the HaloCall API. Without it, requests will be rejected with a 401 Unauthorized error.

### Using Dynamic Variables (Recommended for Multi-Tenant)

Instead of hardcoding values, use dynamic variables for per-agent configuration:

1. **In Agent Settings** → **Overrides** → **Dynamic Variables**:
   - Add `secret__merchant_id` with the merchant's ID
   - Add `secret__elevenlabs_webhook_secret` with the webhook secret

2. **In Tool Headers**, reference the variables:
   - `X-Merchant-ID`: `{{secret__merchant_id}}`
   - `X-ElevenLabs-Secret`: `{{secret__elevenlabs_webhook_secret}}`

This allows sharing tools across agents while customizing authentication per merchant.

## Tool Reference

### 1. list_services

**Purpose**: Get available services and prices.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)* | - | - | Returns all services |

**Example Response** (TTS-optimized):
```
"We offer Swedish Massage at $80, Deep Tissue at $100, and Hot Stone at $120."
```

---

### 2. check_availability

**Purpose**: Find available appointment times.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| service_name | string | Yes | Service name (e.g., "Swedish massage") |
| staff_name | string | No | Staff preference (e.g., "Sarah", "anyone") |
| location_name | string | No | Location if multiple exist |
| date_preference | string | Yes | Natural language date (e.g., "tomorrow", "next Tuesday afternoon") |

**Example Request**:
```json
{
  "service_name": "deep tissue massage",
  "date_preference": "tomorrow afternoon",
  "staff_name": "anyone"
}
```

**Example Response**:
```
"Tomorrow afternoon, I have these times available for a deep tissue massage: 1pm, 2:30pm, or 4pm."
```

---

### 3. book_appointment

**Purpose**: Create a new booking.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| service_name | string | Yes | Service to book |
| time | string | Yes | Specific time (e.g., "tomorrow at 2pm") |
| staff_name | string | No | Staff member name |
| location_name | string | No | Location name |
| customer_phone | string | No | Customer phone (if not already identified) |
| notes | string | No | Appointment notes |

**Example Request**:
```json
{
  "service_name": "Swedish massage",
  "time": "tomorrow at 2pm",
  "staff_name": "Sarah"
}
```

**Example Response**:
```
"I've booked your Swedish Massage with Sarah for tomorrow at 2pm. Is there anything else I can help you with?"
```

---

### 4. lookup_customer

**Purpose**: Find customer by phone number.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| phone | string | Yes | Phone number (any format) |

**Example Response** (if found):
```
"Hi Sarah! I see you're a returning customer. How can I help you today?"
```

**Example Response** (if not found):
```
"I don't have your information on file yet. Can I get your first name to create a profile?"
```

---

### 5. create_customer

**Purpose**: Create a new customer profile.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| first_name | string | Yes | Customer's first name |
| last_name | string | No | Customer's last name |
| phone | string | Yes | Phone number |
| email | string | No | Email address |

---

### 6. get_appointments

**Purpose**: Get customer's upcoming appointments.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| phone | string | Yes | Customer's phone number |

**Example Response**:
```
"You have a Swedish Massage scheduled for Thursday at 2pm with Sarah at Main Street."
```

---

### 7. reschedule_appointment

**Purpose**: Move an existing appointment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| current_appointment | string | Yes | Description (e.g., "my massage tomorrow") |
| new_time | string | Yes | New time (e.g., "Thursday at 3pm") |

**Example Response**:
```
"Done! I've moved your massage from tomorrow at 2pm to Thursday at 3pm."
```

---

### 8. cancel_appointment

**Purpose**: Cancel an existing appointment.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| appointment | string | Yes | Description (e.g., "the Thursday appointment") |
| reason | string | No | Cancellation reason |

**Example Response**:
```
"I've cancelled your massage for Thursday. Would you like to rebook for another time?"
```

## Agent Prompt Guidelines

### Recommended System Prompt

```
You are a friendly receptionist for [BUSINESS NAME]. Your job is to help callers book, reschedule, or cancel appointments.

WORKFLOW:
1. Greet the caller and identify them (use caller ID or ask for phone number)
2. Ask how you can help today
3. For bookings:
   - Ask what service they want
   - Check availability for their preferred time
   - Confirm and book
4. Always confirm important details before taking action

TOOL USAGE:
- Call list_services when asked about services or prices
- Call check_availability before suggesting times
- Always confirm the time with the customer before calling book_appointment
- Use lookup_customer at the start with caller ID
- Only use create_customer if lookup returns not found

SPEAKING STYLE:
- Be conversational and warm
- Keep responses brief - this is a phone call
- Spell out times clearly (say "two PM" not "14:00")
- Confirm back what you heard before booking
```

### First Message Example

```
Hi, thank you for calling [BUSINESS NAME]! This is your AI assistant. How can I help you today?
```

## Multi-Tenant Setup

### One Agent Per Merchant (Recommended)

For each merchant:

1. Create a dedicated agent
2. Attach the shared workspace tools
3. Configure the `X-Merchant-ID` secret header with that merchant's ID
4. Customize the agent's voice, prompt, and first message for the business

### Shared Agent (Not Recommended)

While technically possible to use dynamic merchant IDs, this approach:
- Requires the LLM to pass the merchant ID correctly
- Increases error potential
- Makes debugging harder
- Limits per-merchant customization

## Troubleshooting

### "Merchant not found" Errors

1. Verify the merchant ID is correct: `bun run scripts/list-merchants.ts`
2. Check the `X-Merchant-ID` header is set on the agent's tools
3. Ensure the header is marked as "Secret"

### Service/Staff Not Found

The API uses fuzzy matching but may fail if:
- The name is too different from what's in Square
- There are multiple close matches (response will suggest options)

Check what's available:
```bash
curl -X POST https://your-api.com/voice/services \
  -H "X-Merchant-ID: your_merchant_id"
```

### Date Parsing Issues

The API understands natural language dates like:
- "tomorrow", "next Tuesday", "this Friday"
- "tomorrow at 2pm", "Thursday morning"
- "next week", "in 3 days"

It may struggle with:
- Ambiguous times (just "afternoon" without a date)
- Very complex expressions
- Non-English date formats

### Availability Returns Empty

Check that:
1. The service exists and is active in Square
2. Staff members have availability set up
3. The date isn't too far in the future
4. The location has operating hours configured

## Security Considerations

1. **Always use HTTPS** - Never expose the API over HTTP
2. **Use secret headers** - Mark `X-Merchant-ID` as secret in ElevenLabs
3. **Rotate credentials** - Periodically update merchant IDs if needed
4. **Monitor usage** - Check ElevenLabs analytics for unusual patterns

## API Endpoints Reference

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/voice/services` | POST | List available services |
| `/voice/staff` | POST | List staff members |
| `/voice/locations` | POST | List locations |
| `/voice/availability` | POST | Check available times |
| `/voice/book` | POST | Create booking |
| `/voice/customer` | POST | Look up customer |
| `/voice/customer/create` | POST | Create customer |
| `/voice/appointments` | POST | Get upcoming appointments |
| `/voice/reschedule` | POST | Reschedule appointment |
| `/voice/cancel` | POST | Cancel appointment |

All endpoints accept JSON body and return JSON responses optimized for TTS.
