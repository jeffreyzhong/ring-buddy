# HaloCall

Webhook API endpoints for AI voice agents to manage Square appointments. Built with [Hono](https://hono.dev/) and [Bun](https://bun.sh/).

## Overview

HaloCall provides a complete set of API endpoints that enable AI voice agents to book, modify, and cancel appointments for Square sellers (spas, salons, and other service businesses). The endpoints integrate with Square's Bookings API and related services.

### Voice Agent Documentation

- **[VOICE_AGENT_API_GUIDE.md](./VOICE_AGENT_API_GUIDE.md)** - Complete API reference with request/response examples, booking flows, and best practices for integrating with voice agents.
- **[VOICE_AGENT_README.md](./VOICE_AGENT_README.md)** - Operational manual designed as a system prompt for AI voice agents, with step-by-step flows and reliability guardrails.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **API**: [Square Node.js SDK](https://developer.squareup.com/docs/sdks/nodejs) - Square API integration
- **Deployment**: [Railway](https://railway.app/)

## Project Structure

```
halocall/
├── src/
│   ├── index.ts              # Main Hono app entry point
│   ├── lib/
│   │   └── square.ts         # Square SDK client initialization
│   ├── functions/
│   │   ├── customers/api.ts  # Customer lookup and management
│   │   ├── locations/api.ts  # Business location endpoints
│   │   ├── services/api.ts   # Service catalog endpoints
│   │   ├── staff/api.ts      # Team member endpoints
│   │   ├── availability/api.ts # Time slot availability
│   │   └── bookings/api.ts   # Booking CRUD operations
│   └── types/
│       └── index.ts          # TypeScript type definitions
├── package.json
├── tsconfig.json
├── railway.json              # Railway deployment config
└── README.md
```

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) installed locally
- Square Developer account with API credentials

### Installation

```bash
bun install
```

### Environment Variables

Create a `.env` file with your configuration:

```env
# Database (Supabase)
DATABASE_URL=postgresql://...  # Pooled connection for runtime queries
DIRECT_URL=postgresql://...    # Direct connection for migrations

# Encryption (generate with: openssl rand -base64 32)
ENCRYPTION_KEY=your-encryption-key-here

# Square API (legacy - now stored per-merchant in database)
SQUARE_SANDBOX_ACCESS_TOKEN=your_sandbox_token
SQUARE_PRODUCTION_ACCESS_TOKEN=your_production_token

# Environment
NODE_ENV=development
```

**Note:** Square access tokens are now stored per-merchant in the database (encrypted). The environment variables above are legacy and only used if no merchants are configured.

### Clerk Webhook Configuration

To sync Clerk users to your database, configure the webhook in Clerk Dashboard:

1. **Webhook URL**: `https://halocall-production.up.railway.app/webhooks/clerk`
2. **Events**: Subscribe to all five:
   - `user.updated` - Updates user records when their information changes (email, name, etc.)
   - `user.deleted` - Deletes user records when users are deleted in Clerk
   - `organizationMembership.created` - Creates user record and sets organization when they join an organization
   - `organizationMembership.updated` - Updates user's organization when their membership changes (e.g., role change)
   - `organizationMembership.deleted` - Removes user's organization when they leave an organization
3. **Signing Secret**: Copy the webhook signing secret from Clerk Dashboard
4. **Environment Variable**: Add `CLERK_WEBHOOK_SIGNING_SECRET` to your Railway environment variables

**How it works:**

1. **`user.updated` webhook**: When a user's information is updated in Clerk (email, name, etc.), the webhook will:
   - Verify the webhook signature
   - Update the corresponding user record in your Supabase `users` table with:
     - `email` (updated primary email)
     - `first_name` (updated first name)
     - `last_name` (updated last name)
   - If the user doesn't exist yet (webhook order edge case), it will be handled gracefully
   - Note: Organization ID is not updated here - that's handled by organizationMembership webhooks

2. **`user.deleted` webhook**: When a user is deleted in Clerk, the webhook will:
   - Verify the webhook signature
   - Delete the corresponding user record from your Supabase `users` table
   - If the user doesn't exist (already deleted), it will be handled gracefully

3. **`organizationMembership.created` webhook**: When a user joins an organization, the webhook will:
   - Verify the webhook signature
   - Create a new user record in your Supabase `users` table if the user doesn't exist, or update existing user
   - Sets the user's `clerk_organization_id` in the database
   - User information is extracted from `public_user_data` in the webhook payload:
     - `clerk_user_id` (from `public_user_data.user_id`)
     - `email` (from `public_user_data.identifier`)
     - `first_name` (from `public_user_data.first_name`)
     - `last_name` (from `public_user_data.last_name`)
     - `clerk_organization_id` (from `organization.id`)

4. **`organizationMembership.updated` webhook**: When a user's organization membership is updated (e.g., role change), the webhook will:
   - Verify the webhook signature
   - Update the user's `clerk_organization_id` in the database to ensure it's current
   - If the user doesn't exist yet (webhook order edge case), it will be handled gracefully

5. **`organizationMembership.deleted` webhook**: When a user leaves an organization, the webhook will:
   - Verify the webhook signature
   - Set the user's `clerk_organization_id` to `null` in the database
   - Only updates if the user's current organization matches the one being deleted (handles edge cases)

### Development

```bash
bun run dev
```

The server will start at `http://localhost:3000` with hot reloading.

### Type Checking

```bash
bun run typecheck
```

## Multi-Tenant Setup

HaloCall supports multiple Square sellers (merchants) in a single deployment. Each merchant has their own encrypted Square credentials stored in the database.

### Database Setup

First, push the schema to your database:

```bash
bun run db:push
```

### Adding Merchants

Add a new merchant to the database:

```bash
# With command line arguments
bun run merchant:add --merchant-id=acme-salon --name="Acme Salon" --token=EAAAl... --sandbox

# Or edit the script defaults and run
bun run merchant:add
```

**Options:**
- `--merchant-id=<id>` - Unique identifier for API calls (required)
- `--name=<name>` - Business display name (optional)
- `--token=<token>` - Square access token (required)
- `--refresh-token=<token>` - Square refresh token (optional)
- `--sandbox` - Use sandbox environment
- `--production` - Use production environment (default)

### Listing Merchants

View all merchants in the database:

```bash
bun run merchant:list
```

### API Authentication

All API endpoints require a `merchant_id` to identify which Square seller account to use. Provide it in one of these ways:

1. **Request body:**
   ```json
   {
     "merchant_id": "your-merchant-id",
     "phone_number": "+15551234567"
   }
   ```

2. **Query parameter:**
   ```
   POST /customers/lookup?merchant_id=your-merchant-id
   ```

3. **Header:**
   ```
   X-Merchant-ID: your-merchant-id
   ```

## API Endpoints

### Customer Endpoints (`/customers`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/customers/lookup` | POST | Find customer by phone number (caller ID) |
| `/customers/search` | POST | Search customers by name, email, or phone |
| `/customers/create` | POST | Create new customer profile |
| `/customers/bookings` | POST | Get all bookings for a customer |

### Location Endpoints (`/locations`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/locations/list` | POST | List all business locations |
| `/locations/get` | POST | Get location details with business hours |

### Service Endpoints (`/services`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/services/list` | POST | List all bookable services |
| `/services/get` | POST | Get service details (duration, price) |

### Staff Endpoints (`/staff`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/staff/list` | POST | List bookable team members |
| `/staff/get` | POST | Get staff member details |

### Availability Endpoints (`/availability`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/availability/search` | POST | Search available time slots |

### Booking Endpoints (`/bookings`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/bookings/create` | POST | Create a new appointment |
| `/bookings/get` | POST | Get booking details |
| `/bookings/update` | POST | Modify an existing booking |
| `/bookings/cancel` | POST | Cancel an appointment |
| `/bookings/list` | POST | List bookings with filters |

### Webhook Endpoints (`/webhooks`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/webhooks/clerk` | POST | Clerk webhook endpoint for `user.updated`, `user.deleted`, `organizationMembership.created`, `organizationMembership.updated`, and `organizationMembership.deleted` events |

### System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check endpoint |
| `/` | GET | API documentation |

## Production URL

The production API is deployed at:
```
https://halocall-production.up.railway.app
```

## Example cURL Commands

Replace `BASE_URL` with your deployment URL:
- **Production**: `https://halocall-production.up.railway.app`
- **Local**: `http://localhost:3000`

### Health Check

```bash
# Check if the API is healthy
curl $BASE_URL/health

# Get API documentation
curl $BASE_URL/
```

### Locations

```bash
# List all locations
curl -X POST $BASE_URL/locations/list \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "your-merchant-id"}'

# Get specific location details
curl -X POST $BASE_URL/locations/get \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C"
  }'
```

### Services

```bash
# List all bookable services
curl -X POST $BASE_URL/services/list \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "your-merchant-id"}'

# List services for a specific location
curl -X POST $BASE_URL/services/list \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C"
  }'

# Get specific service details
curl -X POST $BASE_URL/services/get \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "service_id": "ABCDEFGHIJKLMNOP"
  }'
```

### Staff

```bash
# List all bookable staff members
curl -X POST $BASE_URL/staff/list \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "your-merchant-id"}'

# List staff for a specific location
curl -X POST $BASE_URL/staff/list \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C"
  }'

# Get specific staff member details
curl -X POST $BASE_URL/staff/get \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "team_member_id": "TMnVnspoQmdixD23"
  }'
```

### Customers

```bash
# Lookup customer by phone number (caller ID)
curl -X POST $BASE_URL/customers/lookup \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "phone_number": "+12065551234"
  }'

# Search customers by phone
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "phone_number": "206555"
  }'

# Search customers by email
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "email": "john@example.com"
  }'

# Search customers by name
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "name": "John",
    "phone_number": "555"
  }'

# Create a new customer
curl -X POST $BASE_URL/customers/create \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "given_name": "John",
    "family_name": "Doe",
    "email": "john.doe@example.com",
    "phone_number": "+12065551234",
    "note": "Prefers morning appointments"
  }'

# Get all bookings for a customer
curl -X POST $BASE_URL/customers/bookings \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "customer_id": "CUSTOMER_ID_HERE"
  }'
```

### Availability

```bash
# Search for available time slots
curl -X POST $BASE_URL/availability/search \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C",
    "service_variation_id": "FP2MBDGNMUBT6ZFHUR2VVY5R",
    "start_date": "2026-02-01",
    "end_date": "2026-02-07"
  }'

# Search with specific staff member
curl -X POST $BASE_URL/availability/search \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C",
    "service_variation_id": "FP2MBDGNMUBT6ZFHUR2VVY5R",
    "start_date": "2026-02-01",
    "end_date": "2026-02-07",
    "staff_member_ids": ["TMnVnspoQmdixD23"]
  }'
```

### Bookings

```bash
# Create a new booking
curl -X POST $BASE_URL/bookings/create \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C",
    "service_variation_id": "FP2MBDGNMUBT6ZFHUR2VVY5R",
    "start_at": "2026-02-01T14:00:00Z",
    "customer_id": "CUSTOMER_ID_HERE",
    "team_member_id": "TMnVnspoQmdixD23",
    "customer_note": "First time customer"
  }'

# Get booking details
curl -X POST $BASE_URL/bookings/get \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "booking_id": "BOOKING_ID_HERE"
  }'

# Update a booking (change time or note)
curl -X POST $BASE_URL/bookings/update \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "booking_id": "BOOKING_ID_HERE",
    "booking_version": 0,
    "start_at": "2026-02-01T15:00:00Z",
    "customer_note": "Rescheduled to 3pm"
  }'

# Cancel a booking
curl -X POST $BASE_URL/bookings/cancel \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "booking_id": "BOOKING_ID_HERE",
    "booking_version": 1,
    "cancel_reason": "Customer requested cancellation"
  }'

# List all bookings
curl -X POST $BASE_URL/bookings/list \
  -H "Content-Type: application/json" \
  -d '{"merchant_id": "your-merchant-id"}'

# List bookings with filters
curl -X POST $BASE_URL/bookings/list \
  -H "Content-Type: application/json" \
  -d '{
    "merchant_id": "your-merchant-id",
    "location_id": "LTDCH3ZYBBS4C",
    "start_at_min": "2026-02-01T00:00:00Z",
    "start_at_max": "2026-02-28T23:59:59Z",
    "limit": 10
  }'
```

### Example Endpoint (for testing)

```bash
# Echo a message
curl -X POST $BASE_URL/example \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, HaloCall!"}'

# With arguments wrapper (voice agent format)
curl -X POST $BASE_URL/example \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"message": "Hello from voice agent!"}}'
```

### Webhooks

```bash
# Get webhook endpoint info
curl $BASE_URL/webhooks/clerk

# Note: Clerk webhooks require signature verification
# The webhook endpoint is configured in Clerk Dashboard:
# URL: https://halocall-production.up.railway.app/webhooks/clerk
# Events: user.updated, user.deleted, organizationMembership.created, organizationMembership.updated, organizationMembership.deleted
```

## Testing

Run the integration test suite:

```bash
# Run all tests against production
bun test

# Run tests in watch mode
bun test --watch

# Run tests against a different URL
API_BASE_URL=http://localhost:3000 bun test
```

## Deploying to Railway

### 1. Push to GitHub

Ensure your code is pushed to a GitHub repository.

### 2. Create Railway Project

1. Go to [Railway](https://railway.app/)
2. Click "New Project" → "Deploy from GitHub repo"
3. Select your repository

### 3. Configure Environment Variables

In Railway's dashboard, add the following environment variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (pooled) |
| `DIRECT_URL` | PostgreSQL direct connection for migrations |
| `ENCRYPTION_KEY` | Encryption key for merchant tokens (generate with `openssl rand -base64 32`) |
| `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk webhook signing secret (from Clerk Dashboard → Webhooks) |
| `NODE_ENV` | Set to `production` for production deployment |

**Note:** Square access tokens are now stored per-merchant in the database. After deployment, use `bun run merchant:add` to add merchants.

### 4. Deploy

Railway will automatically:
- Detect Bun from the `bun.lock` file
- Install dependencies
- Run the build command
- Start the server

The health check at `/health` will verify the deployment is successful.

## Square OAuth Scopes Required

Your Square access token needs these permissions:
- `CUSTOMERS_READ`, `CUSTOMERS_WRITE`
- `MERCHANT_PROFILE_READ`
- `ITEMS_READ`
- `APPOINTMENTS_READ`, `APPOINTMENTS_WRITE`
- `APPOINTMENTS_ALL_READ`, `APPOINTMENTS_ALL_WRITE`

## License

MIT
