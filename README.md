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
