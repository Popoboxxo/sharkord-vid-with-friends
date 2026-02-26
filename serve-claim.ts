/**
 * Simple HTTP Server for claim-owner.html
 */
import { readFile } from "fs/promises";

const htmlContent = await readFile("./claim-owner.html", "utf-8");

const server = Bun.serve({
  port: 3002,
  fetch() {
    return new Response(htmlContent, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
});

console.log("✅ Claim-Owner Server running on http://localhost:3002");
console.log("Ctrl+C to stop");
