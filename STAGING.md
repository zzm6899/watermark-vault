# Local staging and acceptance tests

Run from the repository root with Node 22.13 or later and both sets of dependencies installed:

```powershell
npm run build
npm --prefix server run test:staging
```

For a preview that stays running after acceptance checks:

```powershell
npm --prefix server run staging
```

Open the printed staging URL. Stop with Ctrl+C. Each run creates a fresh synthetic database, two generated test images, captured `.eml` emails, a server log, and `results.json` under the gitignored `artifacts/staging-*` directory. The application and SMTP receiver bind only to loopback on temporary ports. The child process inherits only essential system environment variables; live payment, email, database, and integration settings are excluded. No client emails are sent. The preview starts with a submitted proofing gallery because the acceptance test has already submitted it.

## Verified on 6 September 2026

- Real Express server serves the built gallery by slug.
- Unauthenticated proof submissions are rejected.
- Proofing receipt is committed to SQLite before HTTP success, and replaying a submission returns the same receipt without another notification.
- Notification reaches the local SMTP receiver and the saved status becomes sent.
- Typing an email alone does not unlock purchased photos.
- Captured email recovery links restore seeded single-photo and full-album purchases in a fresh session.
- Original downloads return the exact fixture bytes; unpaid photos remain inaccessible.
- ZIP preparation includes only the entitled photos.
- Tampered recovery links are rejected; changing a recovered buyer's email cannot relabel their purchases.
- Browser inspection of the real staging gallery shows the submitted receipt and proofing download lock.
- Frontend: 199 tests passed. Server: 99 unit/regression tests plus the staging acceptance run passed. Typecheck, lint, and production build passed.

Staging identified a database durability gap: proofing acknowledged receipt before the debounced database write. Proofing submission now commits synchronously before acknowledging success. Stripe route writes also use the durable writer so saved payment state does not depend on that debounce window.

## Stripe test-mode acceptance completed

On 6 September 2026, the additional run in `artifacts/staging-8rMXL2/results.json` completed real Stripe-hosted sandbox payments using the user's test account:

- A$5 single-photo purchase and A$8 full-album purchase both succeeded with Stripe test cards. Both sessions were confirmed `livemode: false`, `payment_status: paid`, and the expected amount.
- Stripe CLI 1.50.10 forwarded the actual signed `checkout.session.completed` events; the application returned HTTP 200 and granted the expected access.
- Repeating a checkout request reused the same open Stripe session. After payment, both the original session and recovered session were blocked from paying for the same entitlement again.
- The real buyer email was saved with each purchase. Links from locally captured recovery emails restored the correct access in fresh sessions. Single-photo buyers could not download the other photo; full-album buyers could download both.
- Browser testing with Stripe's declined test card displayed the decline message; a database check confirmed no access was granted. Returning from an unpaid album checkout displayed “Payment was cancelled — no charge was made.” The same checkout then completed successfully.
- Restarting the actual server against the saved SQLite database retained the proofing receipt and both real test purchases. This restart check used fresh locally signed recovery credentials rather than old browser cookies.

Test values followed [Stripe's testing documentation](https://docs.stripe.com/testing). No real money moved. Test credentials were held in process memory, not saved in repository files. The payment server and listener stopped after the run.

To repeat with a local Stripe CLI at `artifacts/stripe-cli/stripe.exe`:

```powershell
node server/staging-acceptance.cjs --stripe
node server/staging-restart.cjs artifacts/staging-REPLACE_WITH_RUN_DIRECTORY
```

The first command prints a temporary loopback setup form for a test secret key, then prints each checkout URL. Only `sk_test_` keys are accepted. Do not paste keys into source files. Complete each test checkout while the runner verifies webhook fulfilment and purchase recovery.

## Still requires hosted staging services

Remote email inbox delivery, hosted HTTPS cookie/proxy behavior, delayed or duplicate delivery of real Stripe events, and 3-D Secure challenges remain unverified. Recovery currently requires the buyer to use their emailed recovery link before repeat-purchase prevention applies on a new device. Credits when upgrading a previously purchased single photo to a full album are not implemented or tested by this run.

Docker CLI is installed but its daemon was unavailable; staging ran natively on Windows. No hosted deployment was changed.
