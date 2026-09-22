# Maintenance

Independent bilingual maintenance operations app for one property. It is a mobile-ready PWA with shared accounts and data.

This source is separate from ChatGPT Sites. It uses its own user accounts and can be deployed under an Ink Wave domain.

## Roles

- **Manager:** read-only access to work, team, and performance data.
- **Service Supervisor:** full administrative access, assignments, role approvals, and AI summaries.
- **Technician:** sees daily work, changes status, closes work orders, and adds professional comments.

## Infrastructure

- Next.js application
- Supabase Auth and Postgres database
- Vercel hosting
- Optional OpenAI API for comments, translation, recommendations, and daily summaries

## Setup

1. Create a Supabase project and run `supabase/migrations/202609210001_initial_schema.sql` in its SQL editor.
2. Copy `.env.example` to `.env.local` and add the project values.
3. Set `SUPERVISOR_EMAILS` to the primary Service Supervisor email.
4. Keep `APP_TIMEZONE=America/New_York` for the Ocala property.
5. Install dependencies with `pnpm install`.
6. Run `pnpm dev` for local development or deploy the repository to a compatible Next.js host.

## Updating without replacing the project

The package includes Git version history. Future updates should be committed as incremental changes to this same project instead of replacing the complete source. Before deployment, run:

```sh
pnpm typecheck
pnpm lint
pnpm build
pnpm audit --prod
```

Never expose `SUPABASE_SECRET_KEY` in browser code or commit `.env.local`.
