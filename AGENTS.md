# AGENTS.md

## Commands

- Use npm; this repo has `package-lock.json` and no pnpm/yarn workspace.
- Start locally with `npm run dev`.
- Verify with `npm run build`; it passed on Next 16.2.9.
- `npm run typecheck` runs `tsc --noEmit`, but stale `.next/types` can make it fail on generated files. Run `npm run build` first if it reports missing `.next/types/*` modules.
- `npm run lint` is currently broken because `next lint` is no longer accepted by the installed Next CLI.

## Supabase

- The app uses server-side Supabase only, via `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser/client code; `src/lib/supabase/server.ts` creates the service-role client for server code.
- Initialize/update the database by running `supabase/schema.sql` in the Supabase SQL Editor; it also grants `service_role` table/sequence privileges.
- Without Supabase env vars, pages intentionally render `SetupNotice` instead of connecting to the DB.

## App Shape

- This is a Next App Router app under `src/app`; routes include `/`, `/strategies/new`, `/strategies/[id]`, `/strategies/[id]/plan`, `/strategies/[id]/executions/new`, and `/strategies/[id]/rounds`.
- Mutations live in server actions in `src/app/actions.ts`, then call `revalidatePath` and usually `redirect`.
- Trading calculations live in `src/lib/trading/*`; keep formulas there rather than duplicating them in page components.
- Supabase rows are snake_case and numeric fields may come back as strings; convert through `toStrategyState` / `toNumber` in `src/lib/types.ts` before calculations.
- A sell execution with final position `0` closes the current round, writes `completed_rounds`, links active `executions.round_id`, and resets the strategy for a new normal-mode round.

## Domain Notes

- Supported strategy symbols are `TQQQ`, `SOXL`, and `RAM`; `RAM` uses the same calculations as `SOXL`. Supported split counts are only `20` and `40`, enforced in both types and schema.
- The implemented engine uses original-style V4 concepts: `t_value`, star percent/price, normal mode, and reverse mode.
- Do not treat `Trade.md` as implementation truth by itself; it is a simplified human memo and conflicts with the app code by saying T values are unused.
- `src/lib/trading/*` is the current source of truth for calculation behavior.
- The product is a personal order guide only: no login, brokerage API, automatic trading, or realtime quote fetching.

## Style

- UI text and domain labels are Korean; preserve that unless the task explicitly asks otherwise.
- Path alias `@/*` maps to `src/*`.
