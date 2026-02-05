#!/usr/bin/env bun
/**
 * Debug script to investigate merchant decryption issues.
 * 
 * Usage:
 *   bun run scripts/debug-merchant.ts MLEKEX90YN115
 */

import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { decrypt, verifyEncryptionConfig } from "../src/lib/encryption";
import { createDecipheriv } from 'crypto';

const AUTH_TAG_LENGTH = 16;

async function debugMerchant(merchantId: string) {
  console.log("\n🔍 Debugging merchant:", merchantId);
  console.log("─".repeat(60));

  // Step 1: Check encryption key
  console.log("\n1️⃣  Checking ENCRYPTION_KEY...");
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.log("   ❌ ENCRYPTION_KEY is NOT set!");
    return;
  }
  console.log("   ✅ ENCRYPTION_KEY is set");
  console.log("   📏 Key length:", encryptionKey.length, "characters");
  console.log("   🔑 Key preview:", encryptionKey.substring(0, 8) + "..." + encryptionKey.substring(encryptionKey.length - 4));
  
  const rawKey = Buffer.from(encryptionKey, 'base64');
  console.log("   📐 Decoded key length:", rawKey.length, "bytes");

  // Step 2: Verify encryption config works
  console.log("\n2️⃣  Testing encryption self-test...");
  try {
    verifyEncryptionConfig();
    console.log("   ✅ Encryption self-test passed");
  } catch (error) {
    console.log("   ❌ Encryption self-test failed:", error);
    return;
  }

  // Step 3: Fetch merchant from database
  console.log("\n3️⃣  Fetching merchant from database...");
  const merchant = await prisma.merchant.findUnique({
    where: { merchant_id: merchantId },
  });

  if (!merchant) {
    console.log("   ❌ Merchant not found!");
    return;
  }

  console.log("   ✅ Merchant found");
  console.log("   📊 DB ID:", merchant.id.toString());
  console.log("   🏪 Merchant ID:", merchant.merchant_id);
  console.log("   🌍 Environment:", merchant.is_sandbox ? "Sandbox" : "Production");
  console.log("   ✅ Active:", merchant.is_active);
  console.log("   📅 Created:", merchant.created_at.toISOString());

  // Step 4: Analyze encrypted token - DETAILED
  console.log("\n4️⃣  Analyzing encrypted token...");
  const encryptedToken = merchant.square_access_token_encrypted;
  console.log("   📏 Total length:", encryptedToken.length, "characters");
  
  const parts = encryptedToken.split(':');
  console.log("   🔢 Parts:", parts.length);
  
  if (parts.length === 2) {
    const iv = Buffer.from(parts[0], 'hex');
    const data = Buffer.from(parts[1], 'hex');
    
    console.log("   📦 IV length:", iv.length, "bytes");
    console.log("   📦 Data length:", data.length, "bytes");
    
    // Try different authTag positions
    console.log("\n5️⃣  Trying different decrypt configurations...");
    
    const configs = [
      { name: "authTag at END", authTag: data.subarray(data.length - 16), ciphertext: data.subarray(0, data.length - 16) },
      { name: "authTag at START", authTag: data.subarray(0, 16), ciphertext: data.subarray(16) },
    ];
    
    for (const config of configs) {
      console.log(`\n   Trying: ${config.name}`);
      console.log(`   • authTag (first 8 bytes): ${config.authTag.subarray(0, 8).toString('hex')}`);
      console.log(`   • ciphertext length: ${config.ciphertext.length} bytes`);
      
      try {
        const decipher = createDecipheriv('aes-256-gcm', rawKey, iv);
        decipher.setAuthTag(config.authTag);
        
        const decrypted = Buffer.concat([
          decipher.update(config.ciphertext),
          decipher.final(),
        ]);
        
        console.log(`   ✅ SUCCESS with ${config.name}!`);
        console.log(`   📝 Decrypted: ${decrypted.toString('utf8').substring(0, 20)}...`);
        return;
      } catch (error) {
        console.log(`   ❌ Failed: ${error instanceof Error ? error.message : error}`);
      }
    }
    
    // Try with 12-byte IV (GCM recommended)
    console.log("\n   Trying with 12-byte IV (GCM standard)...");
    const iv12 = Buffer.from(parts[0].substring(0, 24), 'hex'); // 24 hex chars = 12 bytes
    const remainingHex = parts[0].substring(24) + parts[1];
    const dataWith12 = Buffer.from(remainingHex, 'hex');
    
    console.log(`   • IV (12 bytes): ${iv12.toString('hex')}`);
    console.log(`   • Remaining data: ${dataWith12.length} bytes`);
    
    for (const tagPos of ['end', 'start'] as const) {
      const authTag = tagPos === 'end' 
        ? dataWith12.subarray(dataWith12.length - 16)
        : dataWith12.subarray(0, 16);
      const ciphertext = tagPos === 'end'
        ? dataWith12.subarray(0, dataWith12.length - 16)
        : dataWith12.subarray(16);
      
      try {
        const decipher = createDecipheriv('aes-256-gcm', rawKey, iv12);
        decipher.setAuthTag(authTag);
        
        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        
        console.log(`   ✅ SUCCESS with 12-byte IV, authTag at ${tagPos}!`);
        console.log(`   📝 Decrypted: ${decrypted.toString('utf8').substring(0, 20)}...`);
        return;
      } catch (error) {
        console.log(`   ❌ 12-byte IV, authTag at ${tagPos}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  // Step 6: Try library decrypt
  console.log("\n6️⃣  Attempting library decryption...");
  try {
    const decrypted = decrypt(encryptedToken);
    console.log("   ✅ Decryption SUCCESSFUL!");
    console.log("   📏 Decrypted length:", decrypted.length, "characters");
    console.log("   🔑 Token preview:", decrypted.substring(0, 10) + "..." + decrypted.substring(decrypted.length - 4));
  } catch (error) {
    console.log("   ❌ Decryption FAILED!");
    console.log("   💥 Error:", error instanceof Error ? error.message : error);
  }

  console.log("\n" + "─".repeat(60));
}

async function main() {
  const merchantId = process.argv[2];
  
  if (!merchantId) {
    console.error("\n❌ Usage: bun run scripts/debug-merchant.ts <merchant_id>\n");
    process.exit(1);
  }

  try {
    await debugMerchant(merchantId);
  } catch (error) {
    console.error("\n❌ Error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
