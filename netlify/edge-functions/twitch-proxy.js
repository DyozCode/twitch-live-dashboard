/**
 * Netlify Edge Function: Twitch API Proxy
 * ─────────────────────────────────────────────────────────────
 * Diese Funktion läuft auf Netlify's Edge-Netzwerk (Deno-Runtime).
 * Sie holt einen OAuth-Token von Twitch und leitet API-Anfragen
 * sicher weiter — dein Client-Secret bleibt niemals im Browser.
 *
 * Deployment:
 *   1. Repo auf GitHub pushen
 *   2. Netlify → "Import from Git" → Repo auswählen
 *   3. Unter Site Settings → Environment Variables setzen:
 *        TWITCH_CLIENT_ID     = deine_client_id
 *        TWITCH_CLIENT_SECRET = dein_client_secret
 *   4. Deploy → fertig. Deine URL: https://DEINE-SITE.netlify.app
 *
 * API-Keys holen: https://dev.twitch.tv/console → "Register your app"
 *   - Name: beliebig (z.B. "mein-dashboard")
 *   - OAuth Redirect URL: http://localhost
 *   - Category: Website Integration
 */

// Token-Cache (gilt pro Edge-Worker-Instanz, typisch ~10 Min.)
let cachedToken = null;
let tokenExpiry = 0;

async function getTwitchToken(clientId, clientSecret) {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const res = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });

  if (!res.ok) throw new Error(`Token-Fehler: ${res.status}`);
  const data = await res.json();
  cachedToken = data.access_token;
  // 60 Sek. Puffer vor Ablauf
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, context) {
  // CORS-Header für alle Antworten
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Preflight-Request abhandeln
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const clientId = Deno.env.get("TWITCH_CLIENT_ID");
  const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: "Umgebungsvariablen TWITCH_CLIENT_ID und TWITCH_CLIENT_SECRET fehlen." }),
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    const token = await getTwitchToken(clientId, clientSecret);
    const url = new URL(req.url);

    // Erlaubte Endpunkte (Whitelist für Sicherheit)
    const endpoint = url.searchParams.get("endpoint");
    const ALLOWED = ["streams", "users", "channels"];
    if (!endpoint || !ALLOWED.includes(endpoint)) {
      return new Response(
        JSON.stringify({ error: `Endpoint '${endpoint}' nicht erlaubt. Erlaubt: ${ALLOWED.join(", ")}` }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Query-Parameter weiterleiten (z.B. ?user_login=papaplatte&user_login=trymacs)
    const params = new URLSearchParams();
    for (const [key, value] of url.searchParams) {
      if (key !== "endpoint") params.append(key, value);
    }

    const twitchRes = await fetch(
      `https://api.twitch.tv/helix/${endpoint}?${params}`,
      {
        headers: {
          "Client-ID": clientId,
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await twitchRes.json();
    return new Response(JSON.stringify(data), {
      status: twitchRes.status,
      headers: {
        ...corsHeaders,
        // 30 Sek. Browser-Cache, 60 Sek. CDN-Cache
        "Cache-Control": "public, max-age=30, s-maxage=60",
      },
    });

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: corsHeaders }
    );
  }
}

export const config = { path: "/api/twitch" };
