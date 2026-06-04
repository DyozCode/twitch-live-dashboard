/**
 * Netlify Edge Function: Twitch API Proxy (v2 — Live Stats)
 * Holt OAuth-Token, leitet Anfragen weiter, cached Token sicher.
 */

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
  tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

export default async function handler(req, context) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const clientId = Deno.env.get("TWITCH_CLIENT_ID");
  const clientSecret = Deno.env.get("TWITCH_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    return new Response(
      JSON.stringify({ error: "Umgebungsvariablen fehlen." }),
      { status: 500, headers: corsHeaders }
    );
  }

  try {
    const token = await getTwitchToken(clientId, clientSecret);
    const url = new URL(req.url);
    const endpoint = url.searchParams.get("endpoint");
    const ALLOWED = ["streams", "users", "channels", "channels/followers", "subscriptions"];

    if (!endpoint || !ALLOWED.includes(endpoint)) {
      return new Response(
        JSON.stringify({ error: `Endpoint '${endpoint}' nicht erlaubt.` }),
        { status: 400, headers: corsHeaders }
      );
    }

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
        "Cache-Control": "public, max-age=60, s-maxage=120",
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
