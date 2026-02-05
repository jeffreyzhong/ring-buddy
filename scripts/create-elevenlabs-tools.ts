#!/usr/bin/env bun
/**
 * Creates all HaloCall voice tools in ElevenLabs workspace
 * 
 * Usage:
 *   bun run scripts/create-elevenlabs-tools.ts
 *   
 * Options:
 *   --base-url=https://custom-url.com  Override the HaloCall API base URL
 *   --dry-run                          Print tool configs without creating
 * 
 * Note: The ElevenLabs tool API uses OpenAPI 3.0 schema format for webhooks.
 */

import "dotenv/config";

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/convai/tools';

interface OpenAPISchema {
  type: string;
  description?: string;
  properties?: Record<string, { type: string; description: string }>;
  required?: string[];
}

interface WebhookToolConfig {
  type: 'webhook';
  name: string;
  description: string;
  api_schema: {
    url: string;
    method: 'GET' | 'POST';
    request_body_schema?: OpenAPISchema;
    headers?: Record<string, string>;
  };
}

async function createTool(apiKey: string, config: WebhookToolConfig): Promise<string> {
  const response = await fetch(ELEVENLABS_API, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tool_config: config }),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create tool ${config.name}: ${error}`);
  }
  
  const result = await response.json();
  return result.id;
}

function buildToolConfigs(baseUrl: string): WebhookToolConfig[] {
  // Common headers for all tools - uses dynamic variable for merchant ID
  // The {{secret__merchant_id}} placeholder gets replaced per-agent in ElevenLabs
  const commonHeaders = {
    'X-Merchant-ID': '{{secret__merchant_id}}',
    'X-ElevenLabs-Secret': '{{secret__elevenlabs_webhook_secret}}',
    'Content-Type': 'application/json',
  };
  
  return [
    // Tool 1: list_services
    {
      type: 'webhook',
      name: 'list_services',
      description: 'Get the list of available services and their prices. Call this when the customer asks what services are available or you need to confirm service options.',
      api_schema: {
        url: `${baseUrl}/voice/services`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          description: 'No parameters required',
          properties: {},
        },
      },
    },
    
    // Tool 2: check_availability
    {
      type: 'webhook',
      name: 'check_availability',
      description: 'Find available appointment times for a service. Use when the customer wants to book or asks about availability.',
      api_schema: {
        url: `${baseUrl}/voice/availability`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            service_name: { type: 'string', description: "The service the customer wants (e.g., 'Swedish massage', 'haircut'). Use the exact name from list_services if available." },
            staff_name: { type: 'string', description: "Staff member the customer prefers. Use 'anyone' or omit if no preference." },
            location_name: { type: 'string', description: 'Location name if there are multiple locations.' },
            date_preference: { type: 'string', description: "When the customer wants the appointment. Examples: 'tomorrow', 'next Tuesday', 'Thursday afternoon'. Use natural language." },
          },
          required: ['service_name', 'date_preference'],
        },
      },
    },
    
    // Tool 3: book_appointment
    {
      type: 'webhook',
      name: 'book_appointment',
      description: 'Create a new appointment booking. Only call after confirming the time with the customer.',
      api_schema: {
        url: `${baseUrl}/voice/book`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            service_name: { type: 'string', description: 'The service to book (must match a known service).' },
            time: { type: 'string', description: "The specific time to book. Examples: 'tomorrow at 2pm', 'Thursday at 10:30am'. Must be a specific time." },
            staff_name: { type: 'string', description: 'Staff member name if requested.' },
            location_name: { type: 'string', description: 'Location if there are multiple.' },
            customer_phone: { type: 'string', description: "Customer's phone number if not already identified." },
            notes: { type: 'string', description: 'Notes for the appointment.' },
          },
          required: ['service_name', 'time'],
        },
      },
    },
    
    // Tool 4: lookup_customer
    {
      type: 'webhook',
      name: 'lookup_customer',
      description: "Look up a customer by phone number. Use at the start of the call with caller ID, or when customer provides their phone number.",
      api_schema: {
        url: `${baseUrl}/voice/customer`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            phone: { type: 'string', description: "Customer's phone number in any format." },
          },
          required: ['phone'],
        },
      },
    },
    
    // Tool 5: create_customer
    {
      type: 'webhook',
      name: 'create_customer',
      description: 'Create a new customer profile. Use when lookup_customer returns not found.',
      api_schema: {
        url: `${baseUrl}/voice/customer/create`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            first_name: { type: 'string', description: "Customer's first name." },
            last_name: { type: 'string', description: "Customer's last name." },
            phone: { type: 'string', description: "Customer's phone number." },
            email: { type: 'string', description: "Customer's email address." },
          },
          required: ['first_name', 'phone'],
        },
      },
    },
    
    // Tool 6: get_appointments
    {
      type: 'webhook',
      name: 'get_appointments',
      description: "Get a customer's upcoming appointments. Use when customer asks about their existing bookings.",
      api_schema: {
        url: `${baseUrl}/voice/appointments`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            phone: { type: 'string', description: "Customer's phone number." },
          },
          required: ['phone'],
        },
      },
    },
    
    // Tool 7: reschedule_appointment
    {
      type: 'webhook',
      name: 'reschedule_appointment',
      description: 'Reschedule an existing appointment to a new time.',
      api_schema: {
        url: `${baseUrl}/voice/reschedule`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            current_appointment: { type: 'string', description: "Description of the appointment to reschedule. Examples: 'my massage tomorrow', 'the 2pm on Thursday'." },
            new_time: { type: 'string', description: 'The new time for the appointment. Must be a specific time.' },
          },
          required: ['current_appointment', 'new_time'],
        },
      },
    },
    
    // Tool 8: cancel_appointment
    {
      type: 'webhook',
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment.',
      api_schema: {
        url: `${baseUrl}/voice/cancel`,
        method: 'POST',
        headers: commonHeaders,
        request_body_schema: {
          type: 'object',
          properties: {
            appointment: { type: 'string', description: "Description of the appointment to cancel. Examples: 'my massage tomorrow', 'the Thursday appointment'." },
            reason: { type: 'string', description: 'Reason for cancellation.' },
          },
          required: ['appointment'],
        },
      },
    },
  ];
}

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error('Error: ELEVENLABS_API_KEY environment variable is required');
    process.exit(1);
  }
  
  // Parse CLI args
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const baseUrlArg = args.find(a => a.startsWith('--base-url='));
  const baseUrl = baseUrlArg?.split('=')[1] || 'https://halocall-production.up.railway.app';
  
  console.log(`\nHaloCall ElevenLabs Tool Provisioner`);
  console.log(`====================================`);
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'CREATE'}\n`);
  
  const tools = buildToolConfigs(baseUrl);
  
  const createdTools: Array<{ name: string; id: string }> = [];
  const failedTools: Array<{ name: string; error: string }> = [];
  
  for (const tool of tools) {
    if (dryRun) {
      console.log(`[DRY RUN] Would create: ${tool.name}`);
      console.log(JSON.stringify(tool, null, 2));
      console.log();
    } else {
      try {
        const toolId = await createTool(apiKey, tool);
        console.log(`✓ Created: ${tool.name} (ID: ${toolId})`);
        createdTools.push({ name: tool.name, id: toolId });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`✗ Failed: ${tool.name} - ${errorMsg}`);
        failedTools.push({ name: tool.name, error: errorMsg });
      }
    }
  }
  
  console.log(`\nDone! ${tools.length} tools ${dryRun ? 'would be' : ''} created.`);
  
  if (!dryRun) {
    if (createdTools.length > 0) {
      console.log(`\n✓ Successfully created ${createdTools.length} tools:`);
      for (const tool of createdTools) {
        console.log(`  - ${tool.name}: ${tool.id}`);
      }
    }
    
    if (failedTools.length > 0) {
      console.log(`\n✗ Failed to create ${failedTools.length} tools:`);
      for (const tool of failedTools) {
        console.log(`  - ${tool.name}: ${tool.error}`);
      }
    }
    
    console.log(`\nNext steps:`);
    console.log(`1. Go to ElevenLabs Dashboard → Agents`);
    console.log(`2. Create/edit an agent and attach these tools`);
    console.log(`3. Configure the merchant_id secret variable for each agent:`);
    console.log(`   - In agent settings, go to "Dynamic Variables" or "Secrets"`);
    console.log(`   - Add a variable named: merchant_id`);
    console.log(`   - Set its value to the merchant's ID (e.g., "acme-salon")`);
    console.log(`   - Mark as "Secret" so the LLM cannot see it`);
    console.log(`\n   The tools are pre-configured with {{secret__merchant_id}} in the`);
    console.log(`   X-Merchant-ID header, so this value will be injected automatically.`);
  }
}

main();
