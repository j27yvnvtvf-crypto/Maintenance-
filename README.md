# Maintenance

Independent bilingual maintenance operations app for one property. It is a mobile-ready PWA with shared accounts and data.

This source is separate from ChatGPT Sites. It uses its own user accounts and can be deployed under an Ink Wave domain.

## Access model (v2)

Job title and permissions are fully separate:

- **Position / Job Title** is a free-text field each person writes about themselves. It is informational only — writing "Manager", "Supervisor" or "Admin" never grants any permission.
- **Every account starts pending.** A pending, rejected, suspended or revoked account receives no property data: after signing in it only sees its access-request screen, and every data endpoint answers 403. Approval is granted solely by the administrator.
- **Approved accounts all have the same operational permissions**, whatever their job title: create, open, update and close work orders, add comments, and use the AI assistant. Closing a work order never deletes it; its record and history are kept, and each update records who did it and when.
- **Administration is exclusive to one verified account** (the app owner, Jose Suarez). Only the administrator can approve, reject, suspend or revoke accounts, pre-register members, and change how the system works. Every administrative action is written to `admin_audit_log` with actor, target, detail and timestamp.
- Suspension takes effect on the very next request, even with an open session: every API route re-reads the account state from the database per request, and the browser never holds a data-capable key (RLS denies direct access to anon/authenticated). Revocation additionally deletes the auth account.

The administrator flag (`members.is_admin`) is never set by application code, sign-up order, email lists or migrations. It is granted once, manually, by running `docs/admin-bootstrap.sql` in the Supabase SQL editor for the owner-confirmed account (see that file for the confirmation record). `SUPERVISOR_EMAILS` is no longer read by the app and grants nothing.

## Infrastructure

- Next.js application
- Supabase Auth and Postgres database
- Vercel hosting
- Optional OpenAI API for comments, translation, recommendations, and daily summaries

## Setup

1. Create a Supabase project and run **every** SQL file in `supabase/migrations/` in its SQL editor, in filename order (schema first, then the hardening/indexes migration, then the access-model migration).
2. Copy `.env.example` to `.env.local` and add the project values.
3. Keep `APP_TIMEZONE=America/New_York` for the Ocala property.
4. After the owner has signed up, grant the administrator flag by running `docs/admin-bootstrap.sql` manually in the Supabase SQL editor (never add it to the migrations folder). No account is an administrator until that script runs.
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
