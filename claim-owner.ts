/**
 * Claim Owner Permissions in Sharkord
 *
 * Extracts owner token from Docker logs and claims it
 */

const token = "019c9bd0-2d07-7000-a14c-1570ae374b0a";
const sharkordUrl = "http://localhost:3000";

console.log("🔐 Claiming Owner Permissions...");
console.log(`Token: ${token}`);
console.log(`Server: ${sharkordUrl}`);

// Step 1: Check if we can connect
const response = await fetch(`${sharkordUrl}/`, {
  method: "GET",
});

if (!response.ok) {
  console.error("❌ Failed to connect to Sharkord server");
  console.error(`Status: ${response.status}`);
  process.exit(1);
}

console.log("✅ Connected to Sharkord server");

// Step 2: Try to claim the token via API (if available)
// Most Discord-like apps have an /api/auth/claim-token or similar
const claimResponse = await fetch(`${sharkordUrl}/api/auth/claim-token`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ token }),
});

if (claimResponse.ok) {
  console.log("✅ Owner token claimed successfully!");
  const result = await claimResponse.json();
  console.log(`Result:`, result);
  process.exit(0);
} else {
  console.warn(`⚠️  API endpoint not available (${claimResponse.status})`);
  console.log(`\n📝 Manual steps:`);
  console.log(`1. Open browser: ${sharkordUrl}`);
  console.log(`2. Open DevTools: CTRL + SHIFT + I`);
  console.log(`3. Go to Console tab`);
  console.log(`4. Run: useToken("${token}")`);
  console.log(`\nOr the API might use a different endpoint. Trying alternatives...\n`);
}

// Step 3: Try alternative endpoints
const endpoints = [
  "/api/auth/token",
  "/api/owner/claim",
  "/api/token/claim",
  "/trpc/auth.claimToken",
];

for (const endpoint of endpoints) {
  try {
    const altResponse = await fetch(`${sharkordUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    if (altResponse.ok) {
      console.log(`✅ Claimed via endpoint: ${endpoint}`);
      console.log(await altResponse.json());
      process.exit(0);
    }
  } catch {
    // Ignore
  }
}

console.log(
  "ℹ️  Auto-claim failed. Please use browser console method above."
);
