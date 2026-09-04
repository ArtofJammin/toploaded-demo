// GET /health — liveness + which integrations are configured (no secrets leak).
export function register(r) {
  r.get('/health', async ({ env }) => ({
    ok: true,
    service: 'toploaded-api',
    time: new Date().toISOString(),
    integrations: {
      kv: !!env.KV,
      auth: !!(env.TOKEN_SECRET && (env.STAFF_PIN_HASH || env.ADMIN_PIN_HASH)),
      square: !!(env.SQUARE_ACCESS_TOKEN && env.SQUARE_LOCATION_ID),
      squareWebhook: !!env.SQUARE_WEBHOOK_SIGNATURE_KEY,
      email: !!env.RESEND_API_KEY,
      github: !!env.GITHUB_TOKEN,
      pokemontcg: !!env.POKEMONTCG_API_KEY,
    },
  }));
}
