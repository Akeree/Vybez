# Vybez backend foundation

The existing static design is preserved. Vercel Functions under api/ provide the first API layer; Supabase owns identity, PostgreSQL and row-level security.

## Preview setup
1. Create a Supabase project.
2. Apply migrations in supabase/migrations in order using the Supabase CLI or SQL editor.
3. Add SUPABASE_URL and SUPABASE_ANON_KEY to Vercel **Preview** environment only.
4. Add SUPABASE_SERVICE_ROLE_KEY only if a trusted server-side job needs it; never expose it to the browser.
5. Deploy the feature branch as a Vercel preview.
6. Verify GET /api/v1/health and GET /api/v1/me with a valid Supabase access token.

## API foundation
- GET /api/v1/health: readiness check; returns 503 until Supabase settings exist.
- GET /api/v1/me: authenticated profile lookup.
- GET /api/v1/djs: public DJ directory with optional q filter.

## Important
This is a foundation, not a claim that all product integrations are live. OAuth providers, Paystack, Resend, imports, room actions and event workflows require credentials and additional route implementation/testing before production.
