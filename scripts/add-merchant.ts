#!/usr/bin/env bun
/**
 * Interactive wizard to add a new merchant to the database.
 * 
 * Usage:
 *   bun run scripts/add-merchant.ts
 * 
 * Or with arguments (non-interactive):
 *   bun run scripts/add-merchant.ts --merchant-id=my-merchant --token=sq0... --sandbox
 */

import "dotenv/config";
import * as readline from "readline";
import { prisma } from "../src/lib/prisma";
import { encrypt, verifyEncryptionConfig } from "../src/lib/encryption";

interface MerchantInput {
  merchantId: string;
  accessToken: string;
  refreshToken?: string;
  isSandbox: boolean;
  alreadyEncrypted: boolean;
}

function createPrompt(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function runWizard(): Promise<MerchantInput> {
  const rl = createPrompt();
  
  console.log("\n🧙 Add Merchant Wizard\n");
  console.log("This wizard will help you add a new merchant to HaloCall.\n");
  
  try {
    // Merchant ID
    const merchantId = await ask(
      rl,
      "📛 Merchant ID (a unique name you choose, e.g., 'acme-salon', 'downtown-spa'): "
    );
    if (!merchantId) {
      throw new Error("Merchant ID is required");
    }
    
    // Already encrypted?
    const encryptedChoice = await ask(
      rl,
      "🔐 Are the tokens already encrypted? [y/N]: "
    );
    const alreadyEncrypted = encryptedChoice.toLowerCase() === "y" || encryptedChoice.toLowerCase() === "yes";
    
    // Access Token
    const tokenLabel = alreadyEncrypted ? "Encrypted Access Token" : "Square Access Token (plaintext)";
    const accessToken = await ask(
      rl,
      `🔑 ${tokenLabel}: `
    );
    if (!accessToken) {
      throw new Error("Access token is required");
    }
    
    // Refresh Token (optional)
    const refreshLabel = alreadyEncrypted ? "Encrypted Refresh Token" : "Square Refresh Token (plaintext)";
    const refreshToken = await ask(
      rl,
      `🔄 ${refreshLabel} (optional, press Enter to skip): `
    );
    
    // Environment
    const envChoice = await ask(
      rl,
      "🌍 Environment - sandbox or production? [sandbox]: "
    );
    const isSandbox = envChoice.toLowerCase() !== "production";
    
    return {
      merchantId,
      accessToken,
      refreshToken: refreshToken || undefined,
      isSandbox,
      alreadyEncrypted,
    };
  } finally {
    rl.close();
  }
}

function parseArgs(): MerchantInput | null | "wizard" {
  const args = process.argv.slice(2);
  
  // If no args provided, run interactive wizard
  if (args.length === 0) {
    return "wizard";
  }

  // Parse command line arguments
  const parsed: Partial<MerchantInput> = {
    isSandbox: false,
    alreadyEncrypted: false,
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
    } else if (arg === "--encrypted") {
      parsed.alreadyEncrypted = true;
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

When run without arguments, starts an interactive wizard.

Options:
  --merchant-id=<id>       Unique merchant identifier (required for non-interactive)
  --token=<token>          Square access token (required for non-interactive)
  --refresh-token=<token>  Square refresh token (optional)
  --encrypted              Tokens are already encrypted (skip encryption)
  --sandbox                Use sandbox environment (default in wizard)
  --production             Use production environment
  --help, -h               Show this help message

Examples:
  # Interactive wizard (recommended)
  bun run scripts/add-merchant.ts

  # Non-interactive: add a sandbox merchant with plaintext token
  bun run scripts/add-merchant.ts --merchant-id=acme-salon --token=EAAAl... --sandbox

  # Non-interactive: add with pre-encrypted token (from database export)
  bun run scripts/add-merchant.ts --merchant-id=acme-salon --token=abc123encrypted... --encrypted --sandbox
`);
}

async function addMerchant(input: MerchantInput) {
  let encryptedToken: string;
  let encryptedRefreshToken: string | null;
  
  if (input.alreadyEncrypted) {
    console.log("🔐 Using pre-encrypted tokens...");
    encryptedToken = input.accessToken;
    encryptedRefreshToken = input.refreshToken || null;
  } else {
    console.log("🔐 Verifying encryption configuration...");
    verifyEncryptionConfig();

    console.log("🔒 Encrypting access token...");
    encryptedToken = encrypt(input.accessToken);
    encryptedRefreshToken = input.refreshToken
      ? encrypt(input.refreshToken)
      : null;
  }

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
  const result = parseArgs();
  
  if (result === null) {
    process.exit(1);
  }

  let input: MerchantInput;
  
  if (result === "wizard") {
    try {
      input = await runWizard();
      
      // Confirm before proceeding
      const rl = createPrompt();
      console.log("\n📋 Summary:");
      console.log(`   Merchant ID: ${input.merchantId}`);
      console.log(`   Access Token: ${input.accessToken.slice(0, 20)}...`);
      console.log(`   Refresh Token: ${input.refreshToken ? input.refreshToken.slice(0, 20) + "..." : "(none)"}`);
      console.log(`   Tokens: ${input.alreadyEncrypted ? "Pre-encrypted" : "Will be encrypted"}`);
      console.log(`   Environment: ${input.isSandbox ? "Sandbox" : "Production"}`);
      
      const confirm = await ask(rl, "\n✅ Create this merchant? [Y/n]: ");
      rl.close();
      
      if (confirm.toLowerCase() === "n" || confirm.toLowerCase() === "no") {
        console.log("\n❌ Cancelled.\n");
        process.exit(0);
      }
    } catch (error) {
      console.error("\n❌ Error:", error instanceof Error ? error.message : error);
      process.exit(1);
    }
  } else {
    input = result;
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
