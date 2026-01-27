# Ring Buddy

Webhook API endpoints for AI voice agents to manage Square appointments. Built with [Hono](https://hono.dev/) and [Bun](https://bun.sh/).

## Overview

Ring Buddy provides a complete set of API endpoints that enable AI voice agents to book, modify, and cancel appointments for Square sellers (spas, salons, and other service businesses). The endpoints integrate with Square's Bookings API and related services.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh/) - Fast JavaScript runtime
- **Framework**: [Hono](https://hono.dev/) - Lightweight web framework
- **API**: [Square Node.js SDK](https://developer.squareup.com/docs/sdks/nodejs) - Square API integration
- **Deployment**: [Railway](https://railway.app/)

## Project Structure

```
ring-buddy/
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

Create a `.env` file with your Square credentials:

```env
SQUARE_SANDBOX_ACCESS_TOKEN=your_sandbox_token
SQUARE_PRODUCTION_ACCESS_TOKEN=your_production_token
NODE_ENV=development
```

### Development

```bash
bun run dev
```

The server will start at `http://localhost:3000` with hot reloading.

### Type Checking

```bash
bun run typecheck
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

### System Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check endpoint |
| `/` | GET | API documentation |

## Example cURL Commands

Replace `BASE_URL` with your deployment URL (e.g., `https://ring-buddy-production.up.railway.app`).

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
  -d '{}'

# Get specific location details
curl -X POST $BASE_URL/locations/get \
  -H "Content-Type: application/json" \
  -d '{"location_id": "LTDCH3ZYBBS4C"}'
```

### Services

```bash
# List all bookable services
curl -X POST $BASE_URL/services/list \
  -H "Content-Type: application/json" \
  -d '{}'

# List services for a specific location
curl -X POST $BASE_URL/services/list \
  -H "Content-Type: application/json" \
  -d '{"location_id": "LTDCH3ZYBBS4C"}'

# Get specific service details
curl -X POST $BASE_URL/services/get \
  -H "Content-Type: application/json" \
  -d '{"service_id": "ABCDEFGHIJKLMNOP"}'
```

### Staff

```bash
# List all bookable staff members
curl -X POST $BASE_URL/staff/list \
  -H "Content-Type: application/json" \
  -d '{}'

# List staff for a specific location
curl -X POST $BASE_URL/staff/list \
  -H "Content-Type: application/json" \
  -d '{"location_id": "LTDCH3ZYBBS4C"}'

# Get specific staff member details
curl -X POST $BASE_URL/staff/get \
  -H "Content-Type: application/json" \
  -d '{"team_member_id": "TMnVnspoQmdixD23"}'
```

### Customers

```bash
# Lookup customer by phone number (caller ID)
curl -X POST $BASE_URL/customers/lookup \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "+12065551234"}'

# Search customers by phone
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{"phone_number": "206555"}'

# Search customers by email
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{"email": "john@example.com"}'

# Search customers by name
curl -X POST $BASE_URL/customers/search \
  -H "Content-Type: application/json" \
  -d '{"name": "John", "phone_number": "555"}'

# Create a new customer
curl -X POST $BASE_URL/customers/create \
  -H "Content-Type: application/json" \
  -d '{
    "given_name": "John",
    "family_name": "Doe",
    "email": "john.doe@example.com",
    "phone_number": "+12065551234",
    "note": "Prefers morning appointments"
  }'

# Get all bookings for a customer
curl -X POST $BASE_URL/customers/bookings \
  -H "Content-Type: application/json" \
  -d '{"customer_id": "CUSTOMER_ID_HERE"}'
```

### Availability

```bash
# Search for available time slots
curl -X POST $BASE_URL/availability/search \
  -H "Content-Type: application/json" \
  -d '{
    "location_id": "LTDCH3ZYBBS4C",
    "service_variation_id": "FP2MBDGNMUBT6ZFHUR2VVY5R",
    "start_date": "2026-02-01",
    "end_date": "2026-02-07"
  }'

# Search with specific staff member
curl -X POST $BASE_URL/availability/search \
  -H "Content-Type: application/json" \
  -d '{
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
  -d '{"booking_id": "BOOKING_ID_HERE"}'

# Update a booking (change time or note)
curl -X POST $BASE_URL/bookings/update \
  -H "Content-Type: application/json" \
  -d '{
    "booking_id": "BOOKING_ID_HERE",
    "booking_version": 0,
    "start_at": "2026-02-01T15:00:00Z",
    "customer_note": "Rescheduled to 3pm"
  }'

# Cancel a booking
curl -X POST $BASE_URL/bookings/cancel \
  -H "Content-Type: application/json" \
  -d '{
    "booking_id": "BOOKING_ID_HERE",
    "booking_version": 1,
    "cancel_reason": "Customer requested cancellation"
  }'

# List all bookings
curl -X POST $BASE_URL/bookings/list \
  -H "Content-Type: application/json" \
  -d '{}'

# List bookings with filters
curl -X POST $BASE_URL/bookings/list \
  -H "Content-Type: application/json" \
  -d '{
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
  -d '{"message": "Hello, Ring Buddy!"}'

# With arguments wrapper (voice agent format)
curl -X POST $BASE_URL/example \
  -H "Content-Type: application/json" \
  -d '{"arguments": {"message": "Hello from voice agent!"}}'
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
| `SQUARE_SANDBOX_ACCESS_TOKEN` | Square Sandbox API token |
| `SQUARE_PRODUCTION_ACCESS_TOKEN` | Square Production API token |
| `NODE_ENV` | Set to `production` for production deployment |

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
