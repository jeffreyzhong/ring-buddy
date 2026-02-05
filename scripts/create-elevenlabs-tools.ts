/**
 * Creates all HaloCall voice tools in ElevenLabs workspace
 * 
 * Usage:
 *   ELEVENLABS_API_KEY=your_key bun run scripts/create-elevenlabs-tools.ts
 *   
 * Options:
 *   --base-url=https://custom-url.com  Override the HaloCall API base URL
 *   --dry-run                          Print tool configs without creating
 */

const ELEVENLABS_API = 'https://api.elevenlabs.io/v1/convai/tools';

interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
}

interface WebhookToolConfig {
  type: 'webhook';
  name: string;
  description: string;
  params: {
    method: 'GET' | 'POST';
    url: string;
    request_headers?: Record<string, string>;
    body_parameters?: ToolParameter[];
    query_parameters?: ToolParameter[];
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
  return [
    // Tool 1: list_services
    {
      type: 'webhook',
      name: 'list_services',
      description: 'Get the list of available services and their prices. Call this when the customer asks what services are available or you need to confirm service options.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/services`,
      },
    },
    
    // Tool 2: check_availability
    {
      type: 'webhook',
      name: 'check_availability',
      description: 'Find available appointment times for a service. Use when the customer wants to book or asks about availability.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/availability`,
        body_parameters: [
          { name: 'service_name', type: 'string', description: "The service the customer wants (e.g., 'Swedish massage', 'haircut'). Use the exact name from list_services if available.", required: true },
          { name: 'staff_name', type: 'string', description: "Optional. Staff member the customer prefers. Use 'anyone' or omit if no preference." },
          { name: 'location_name', type: 'string', description: 'Optional. Location name if there are multiple locations.' },
          { name: 'date_preference', type: 'string', description: "When the customer wants the appointment. Examples: 'tomorrow', 'next Tuesday', 'Thursday afternoon'. Use natural language.", required: true },
        ],
      },
    },
    
    // Tool 3: book_appointment
    {
      type: 'webhook',
      name: 'book_appointment',
      description: 'Create a new appointment booking. Only call after confirming the time with the customer.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/book`,
        body_parameters: [
          { name: 'service_name', type: 'string', description: 'The service to book (must match a known service).', required: true },
          { name: 'time', type: 'string', description: "The specific time to book. Examples: 'tomorrow at 2pm', 'Thursday at 10:30am'. Must be a specific time.", required: true },
          { name: 'staff_name', type: 'string', description: 'Optional. Staff member name if requested.' },
          { name: 'location_name', type: 'string', description: 'Optional. Location if there are multiple.' },
          { name: 'customer_phone', type: 'string', description: "Customer's phone number if not already identified." },
          { name: 'notes', type: 'string', description: 'Optional notes for the appointment.' },
        ],
      },
    },
    
    // Tool 4: lookup_customer
    {
      type: 'webhook',
      name: 'lookup_customer',
      description: "Look up a customer by phone number. Use at the start of the call with caller ID, or when customer provides their phone number.",
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/customer`,
        body_parameters: [
          { name: 'phone', type: 'string', description: "Customer's phone number in any format.", required: true },
        ],
      },
    },
    
    // Tool 5: create_customer
    {
      type: 'webhook',
      name: 'create_customer',
      description: 'Create a new customer profile. Use when lookup_customer returns not found.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/customer/create`,
        body_parameters: [
          { name: 'first_name', type: 'string', description: "Customer's first name.", required: true },
          { name: 'last_name', type: 'string', description: "Customer's last name (optional)." },
          { name: 'phone', type: 'string', description: "Customer's phone number.", required: true },
          { name: 'email', type: 'string', description: "Customer's email address (optional)." },
        ],
      },
    },
    
    // Tool 6: get_appointments
    {
      type: 'webhook',
      name: 'get_appointments',
      description: "Get a customer's upcoming appointments. Use when customer asks about their existing bookings.",
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/appointments`,
        body_parameters: [
          { name: 'phone', type: 'string', description: "Customer's phone number.", required: true },
        ],
      },
    },
    
    // Tool 7: reschedule_appointment
    {
      type: 'webhook',
      name: 'reschedule_appointment',
      description: 'Reschedule an existing appointment to a new time.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/reschedule`,
        body_parameters: [
          { name: 'current_appointment', type: 'string', description: "Description of the appointment to reschedule. Examples: 'my massage tomorrow', 'the 2pm on Thursday'.", required: true },
          { name: 'new_time', type: 'string', description: 'The new time for the appointment. Must be a specific time.', required: true },
        ],
      },
    },
    
    // Tool 8: cancel_appointment
    {
      type: 'webhook',
      name: 'cancel_appointment',
      description: 'Cancel an existing appointment.',
      params: {
        method: 'POST',
        url: `${baseUrl}/voice/cancel`,
        body_parameters: [
          { name: 'appointment', type: 'string', description: "Description of the appointment to cancel. Examples: 'my massage tomorrow', 'the Thursday appointment'.", required: true },
          { name: 'reason', type: 'string', description: 'Optional reason for cancellation.' },
        ],
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
    console.log(`3. Add X-Merchant-ID header (as secret) for each agent`);
    console.log(`   - In agent settings, go to Tools → (each tool) → Headers`);
    console.log(`   - Add header: X-Merchant-ID = your_merchant_id`);
    console.log(`   - Mark as "Secret" to hide from the LLM`);
  }
}

main();
