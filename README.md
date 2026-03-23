# TransportLedger V2

[![Expo SDK](https://img.shields.io/badge/Expo-SDK%2052-000020?logo=expo&logoColor=white)](https://expo.dev/)
[![React Native](https://img.shields.io/badge/React%20Native-0.76-61dafb?logo=react&logoColor=white)](https://reactnative.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Jest](https://img.shields.io/badge/Tested%20with-Jest-c21325?logo=jest&logoColor=white)](https://jestjs.io/)
[![Supabase](https://img.shields.io/badge/Backend-Supabase-3ecf8e?logo=supabase&logoColor=white)](https://supabase.com/)

TransportLedger is an Expo + React Native app for transport-owner accounting and monthly vehicle settlement workflows.

It is built for admin-side operations such as:
- Maintaining transport owners and vehicles
- Capturing diesel and trip entries
- Managing GST and deductions
- Recording payments and transport income
- Exporting reports (Excel) and printable artifacts
- Continuing write operations while offline, then syncing automatically

## Quick Start (60 Seconds)

1. Install dependencies:

```bash
yarn install
```

2. Create local environment file:

```bash
copy .env.example .env
```

3. Set your Supabase values in `.env`:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

4. Run the app:

```bash
yarn start
```

5. Initialize database once:
- Open Supabase SQL Editor
- Run the script in `SUPABASE_SCHEMA.sql`

If startup fails, verify env variable names exactly match this README.

## Highlights

- Expo Router navigation with tab-first UX
- Supabase as the backend database
- React Query caching and background refresh
- Offline write-through queue with retry + conflict handling UI
- Month-wise settlement calculations
- Excel export flows (diesel sheet, transporter ledger, settlement)
- Jest test coverage for core calculations and queue behavior

## Tech Stack

- Runtime: React Native 0.76, Expo SDK 52
- Navigation: expo-router
- Data fetching/cache: @tanstack/react-query
- Backend: Supabase (Postgres + REST)
- Storage (offline queue): AsyncStorage
- Exports: xlsx-js-style, expo-file-system, expo-sharing, expo-print
- Validation/forms: react-hook-form, zod
- Styling: nativewind + inline RN styles
- Testing: jest + jest-expo

## Project Structure

```text
app/
  _layout.tsx
  queue.tsx
  diesel-logs.tsx
  (tabs)/
    _layout.tsx
    index.tsx          # Home dashboard
    entry.tsx          # Quick entries (diesel/trip)
    transporters.tsx   # Owners list and rate management
    reports.tsx        # Export center + route rates
  transporter/[id].tsx # Owner detail
  vehicle/[id].tsx     # Vehicle detail

components/
  AppDataProvider.tsx
  OfflineQueueButton.tsx
  OfflineQueueManager.tsx
  OfflineQueueNoticeBridge.tsx
  ThemedNoticeProvider.tsx
  ...

lib/
  supabase.ts          # Supabase client initialization
  queries.ts           # DB operations
  summaries.ts         # Screen bootstrap/summarized queries
  calculations.ts      # Settlement and earnings logic
  offlineQueue.ts      # Queue, retry, conflict policies
  excel.ts             # Excel generation and sharing
  pdf.ts               # PDF/print helpers

__tests__/
  calculations.test.ts
  offlineQueue.test.ts
  activityHistory.test.ts

SUPABASE_SCHEMA.sql    # Full schema to initialize DB
```

## Prerequisites

- Node.js 18+
- Yarn 1.x (recommended because this repo includes yarn.lock)
- Expo CLI (optional, `npx expo` also works)
- Supabase project

## Environment Variables

The app reads environment variables from `.env` using Expo public env keys.

Required variables:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`

### Setup

1. Copy `.env.example` to `.env`
2. Fill in real Supabase values

Example:

```env
EXPO_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

Notes:
- `.env` is ignored by git
- `.env.example` is committed for team onboarding
- `lib/supabase.ts` throws a clear runtime error when env vars are missing

## Local Development

Install dependencies:

```bash
yarn install
```

Start app:

```bash
yarn start
```

Then run on:
- Android emulator/device
- iOS simulator/device (macOS)
- Expo Go or Dev Client as needed

## Database Setup (Supabase)

1. Open your Supabase project
2. Go to SQL Editor
3. Create a new query
4. Paste contents of `SUPABASE_SCHEMA.sql`
5. Run the script

This creates all core tables, indexes, and helper views for the app domain:
- transport_owners
- vehicles
- routes
- trip_entries
- diesel_logs
- gst_entries
- other_deductions
- transport_income
- payments

Current schema defaults to RLS disabled (admin-oriented app mode).
If you are exposing APIs to untrusted clients, enable and configure RLS before production launch.

## Core Workflows

### 1) Owners and Vehicles
- Create transport owners with commission and accidental rates
- Add vehicles linked to owners
- Maintain GST commission rate per vehicle

### 2) Quick Entry
- Diesel entry:
  - Stores litres by date
  - Auto-derives month, fortnight, buy/sell amount, and profit
- Trip entry:
  - Stores tonnes and rate snapshot
  - Auto-calculates amount

### 3) Settlement Inputs
Per vehicle and month:
- Trips (gross freight)
- Diesel logs
- GST entries
- Other deductions
- Payments

### 4) Reports & Export
From Reports tab:
- Diesel tracking sheet export
- Transporter ledger export
- Vehicle settlement voucher export

## Offline Queue Behavior

Write operations pass through a write-through queue:
- If online: writes go to Supabase immediately
- If offline/network failure: action is queued in AsyncStorage
- On reconnect/manual retry: queue flush attempts are made

Queue characteristics:
- Retries increment on failure
- After retry threshold, item can be marked as conflict
- Conflict resolution available in app `queue` screen:
  - Retry item
  - Remove item
  - Open related screen

Deduping policy:
- Idempotent update/delete-style actions are deduped
- Create-style actions are not deduped

## Testing

Run tests:

```bash
yarn test
```

Current tests cover:
- Settlement and admin earnings calculations
- Offline queue dedupe logic
- Activity history ordering/limits

## Build and Release Notes

Project metadata is in `app.json`.
Configured identifiers:
- Android package: `com.transportledger.app`
- iOS bundle id: `com.transportledger.app`

For EAS-managed builds, ensure:
- Correct project ID in `app.json`
- Environment variables configured in local shell and/or EAS secrets
- Native dependency compatibility with Expo SDK 52

## GitHub Push Checklist

Before push:
- Ensure `.env` is present locally but not tracked
- Confirm `.env.example` is up to date
- Rotate any key that was ever committed in history
- Re-run tests
- Review `git status`

Useful commands:

```bash
git status --short
git ls-files .env .env.local .env.example
yarn test
```

Expected result:
- `.env` should not appear as tracked
- `.env.example` should be tracked

## Troubleshooting

### Missing Supabase env vars
Error:
- `Missing Supabase env vars. Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY in your .env file.`

Fix:
- Check `.env` exists at project root
- Verify variable names and values
- Restart Expo dev server after changing env

### Exports fail
- Check file-system/share permissions on device
- Ensure required owner/vehicle/month selections are made
- Validate month/date format from UI selections

### Queue keeps pending items
- Verify device internet access
- Open Queue screen and use Retry Now
- Inspect conflict reason and resolve from related screen

## Security Notes

- Never commit `.env`
- Use only anon/public Supabase keys in client app
- Never embed service-role keys in mobile code
- Rotate exposed keys immediately

## Scripts

Available npm scripts:

- `yarn start` - Start Expo dev server
- `yarn test` - Run Jest tests once (non-watch)

## Contributing

### Branching

- Create feature branches from `main`
- Branch naming recommendation:
  - `feature/<short-description>`
  - `fix/<short-description>`
  - `chore/<short-description>`

Examples:
- `feature/offline-queue-notices`
- `fix/diesel-log-month-filter`

### Commit Conventions

Use clear, action-focused commit messages.

Recommended style:
- `feat: add vehicle settlement export progress`
- `fix: prevent duplicate diesel update queue actions`
- `docs: expand environment setup in readme`
- `test: add queue conflict retry coverage`

### Pull Request Checklist

Before opening a PR:

1. Rebase/merge latest `main`
2. Ensure `.env` is not tracked
3. Keep `.env.example` updated if env contract changes
4. Run tests with `yarn test`
5. Include screenshots/video for UI changes
6. Mention schema impacts if `SUPABASE_SCHEMA.sql` changed
7. Add rollout notes for behavior changes (especially queue logic)

### Code Review Focus

Reviewers should prioritize:
- Settlement correctness and rounding behavior
- Offline queue idempotency and conflict handling
- Data consistency between summaries and detail screens
- Export file correctness (headers, totals, month filters)

## License

No license file is currently included. Add a `LICENSE` file before open-source distribution.
