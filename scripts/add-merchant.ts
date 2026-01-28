#!/usr/bin/env bun
/**
 * Script to add a new merchant to the database.
 * 
 * Usage:
 *   bun run scripts/add-merchant.ts
 * 
 * Or with arguments:
 *   bun run scripts/add-merchant.ts --merchant-id=my-merchant --name="My Business" --token=sq0... --sandbox
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { encrypt, verifyEncryptionConfig } from "../src/lib/encryption";

interface MerchantInput {
  merchantId: string;
  accessToken: string;
  refreshToken?: string;
  isSandbox: boolean;
}

function parseArgs(): MerchantInput | null {
  const args = process.argv.slice(2);
  
  // If no args provided, use interactive defaults (edit these values)
  if (args.length === 0) {
    console.log("\n📝 No arguments provided. Using default values below.");
    console.log("   Edit this script or pass arguments to customize.\n");
    
    // ============================================
    // EDIT THESE VALUES FOR MANUAL MERCHANT ENTRY
    // ============================================
    return {
      merchantId: "example-merchant-id",      // Unique ID for API calls
      accessToken: "YOUR_SQUARE_ACCESS_TOKEN", // Square access token
      refreshToken: undefined,                 // Optional: Square refresh token
      isSandbox: true,                         // true for sandbox, false for production
    };
  }

  // Parse command line arguments
  const parsed: Partial<MerchantInput> = {
    isSandbox: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--merchant-id=")) {
      parsed.merchantId = arg.split("=")[1];
    } else if (arg.startsWith("--token=")) {
      parsed.accessToken = arg.split("=")[1];
    } else if (arg.startsWith("--refresh-token=")) {
      parsed.refreshToken = arg.split("=")[1];
    } else if (arg === "--sandbox") {
      parsed.isSandbox = true;
    } else if (arg === "--production") {
      parsed.isSandbox = false;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      return null;
    }
  }

  if (!parsed.merchantId || !parsed.accessToken) {
    console.error("❌ Error: --merchant-id and --token are required\n");
    printUsage();
    return null;
  }

  return parsed as MerchantInput;
}

function printUsage() {
  console.log(`
Usage: bun run scripts/add-merchant.ts [options]

Options:
  --merchant-id=<id>       Unique merchant identifier (required)
  --token=<token>          Square access token (required)
  --refresh-token=<token>  Square refresh token (optional)
  --sandbox                Use sandbox environment (default: production)
  --production             Use production environment
  --help, -h               Show this help message

Examples:
  # Add a sandbox merchant
  bun run scripts/add-merchant.ts --merchant-id=acme-salon --token=EAAAl... --sandbox

  # Add a production merchant
  bun run scripts/add-merchant.ts --merchant-id=acme-salon --token=EAAAl... --production
`);
}

async function addMerchant(input: MerchantInput) {
  console.log("🔐 Verifying encryption configuration...");
  verifyEncryptionConfig();

  console.log("🔒 Encrypting access token...");
  const encryptedToken = encrypt(input.accessToken);
  const encryptedRefreshToken = input.refreshToken
    ? encrypt(input.refreshToken)
    : null;

  console.log("📝 Creating merchant record...");
  
  try {
    const merchant = await prisma.merchant.create({
      data: {
        merchant_id: input.merchantId,
        square_access_token_encrypted: encryptedToken,
        square_refresh_token_encrypted: encryptedRefreshToken,
        is_sandbox: input.isSandbox,
        is_active: true,
      },
    });

    console.log("\n✅ Merchant created successfully!\n");
    console.log("   ID:", merchant.id.toString());
    console.log("   Merchant ID:", merchant.merchant_id);
    console.log("   Environment:", merchant.is_sandbox ? "Sandbox" : "Production");
    console.log("   Active:", merchant.is_active);
    console.log("   Created:", merchant.created_at.toISOString());
    console.log("\n📌 Use this merchant_id in API calls:", merchant.merchant_id);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      console.error(`\n❌ Error: Merchant with ID "${input.merchantId}" already exists.`);
      console.error("   Use a different merchant_id or update the existing record.\n");
    } else {
      throw error;
    }
  }
}

async function main() {
  const input = parseArgs();
  
  if (!input) {
    process.exit(1);
  }

  // Validate the token doesn't look like a placeholder
  if (input.accessToken === "YOUR_SQUARE_ACCESS_TOKEN") {
    console.error("\n❌ Error: Please replace 'YOUR_SQUARE_ACCESS_TOKEN' with an actual token.");
    console.error("   Edit the script or pass --token=<your-token>\n");
    process.exit(1);
  }

  try {
    await addMerchant(input);
  } catch (error) {
    console.error("\n❌ Error adding merchant:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
