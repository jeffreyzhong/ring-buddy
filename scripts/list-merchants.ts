#!/usr/bin/env bun
/**
 * Script to list all merchants in the database.
 * 
 * Usage:
 *   bun run scripts/list-merchants.ts
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function listMerchants() {
  const merchants = await prisma.merchants.findMany({
    orderBy: { created_at: "desc" },
  });

  if (merchants.length === 0) {
    console.log("\n📭 No merchants found in the database.\n");
    console.log("   Run 'bun run scripts/add-merchant.ts' to add one.\n");
    return;
  }

  console.log(`\n📋 Found ${merchants.length} merchant(s):\n`);
  console.log("─".repeat(80));

  for (const merchant of merchants) {
    console.log(`
  Merchant ID:    ${merchant.merchant_id}
  Business Name:  ${merchant.business_name || "(not set)"}
  Environment:    ${merchant.is_sandbox ? "🧪 Sandbox" : "🚀 Production"}
  Status:         ${merchant.is_active ? "✅ Active" : "❌ Inactive"}
  Created:        ${merchant.created_at.toISOString()}
  Updated:        ${merchant.updated_at.toISOString()}
  DB ID:          ${merchant.id.toString()}
`);
    console.log("─".repeat(80));
  }
}

async function main() {
  try {
    await listMerchants();
  } catch (error) {
    console.error("\n❌ Error listing merchants:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
