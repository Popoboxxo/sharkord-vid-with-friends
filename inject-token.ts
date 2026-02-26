/**
 * Auto-claim owner token by injecting JavaScript into Sharkord's DOM
 * This uses a VERY hacky approach: extracting the HTML, injecting script, and serving it back
 */

const TOKEN = "019c9be5-bb4f-7000-98df-0e57c8441fda";
const SHARKORD_URL = "http://localhost:3000";

console.log("🔐 Auto-claim Proxy Server starting...");
console.log(`Token: ${TOKEN}`);
console.log(`Proxying Sharkord from ${SHARKORD_URL}...`);

// Serve modified HTML on port 3003
const server = Bun.serve({
  port: 3003,
  async fetch(req) {
    const url = new URL(req.url);
    const targetUrl = SHARKORD_URL + url.pathname + url.search;
    
    // Forward alle requests zu echtem Sharkord
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.method !== "GET" && req.method !== "HEAD" ? req.body : null,
    });
    
    // Check ob response HTML ist
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("text/html")) {
      let html = await response.text();
      
      // Prüfe ob Nutzer angemeldet ist (einfache Heuristik: nach Login-Button suchen)
      const isLoggedIn = !html.includes("login") || html.includes("logout") || html.includes("useToken");
      
      if (isLoggedIn) {
        // Nutzer ist angemeldet - injiziere Token-Claiming Script
        const injectionScript = `
<script>
  (function() {
    const token = "${TOKEN}";
    const maxRetries = 5;
    let retries = 0;
    
    function claimToken() {
      if (typeof useToken === 'function') {
        console.log('🔐 useToken found! Auto-claiming...', token);
        useToken(token);
        console.log('✅ Token claimed successfully!');
      } else {
        retries++;
        if (retries < maxRetries) {
          console.log('⏳ Waiting for useToken function... (attempt ' + retries + ')');
          setTimeout(claimToken, 500);
        } else {
          console.warn('❌ Could not find useToken function after ' + maxRetries + ' attempts');
        }
      }
    }
    
    // Start claiming jetzt auf ein kleines Delay
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', claimToken);
    } else {
      claimToken();
    }
  })();
</script>
`;
        
        html = html.replace("</body>", injectionScript + "</body>");
      }
      
      // Return modified HTML mit korrektem Status + Headers
      const newHeaders = new Headers(response.headers);
      newHeaders.set("content-type", "text/html; charset=utf-8");
      
      return new Response(html, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
      });
    }
    
    // Für nicht-HTML responses: einfach durchleiten
    return response;
  },
});

console.log("✅ Proxy server running on http://localhost:3003");
console.log("\n📝 Instructions:");
console.log("   1️⃣  Open http://localhost:3003");
console.log("   2️⃣  Login with credentials: test / test");
console.log("   3️⃣  Token will be auto-claimed after login!");
console.log("   4️⃣  You can now use /watch command\n");
console.log("Ctrl+C to stop");
