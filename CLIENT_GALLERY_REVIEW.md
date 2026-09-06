# Client-facing gallery and payment review

Reviewed 6 September 2026. Changes are local and have not been deployed.

## Scope and evidence

Reviewed the PhotoFlow public route setup, album viewer, purchase panel, Stripe album checkout and fulfilment, proofing submission, redacted gallery data, client portal link construction, and album slug lookup. Inspected the separate Zacmorganphotography website source at a high level; no changes were made there. Browser verification used the local proofing demo, not a production client album. The local root page rendered the booking shell, but without a connected API it did not load services. This is not evidence of a production outage.

## Fixed

| Issue | Result |
| --- | --- |
| Selecting every photo implicitly selected the album package even when it cost more | Card and bank dialogs now share the same choice: explicit album request, cheaper package, or individual selection. Example: two $10 photos stay $20 when the album is $100. |
| Free allowance was removed in the browser and again by the server | Card requests now send the unpaid selection including quota-eligible photos. The server determines which IDs are billable. |
| Webhook revalidation repriced only the already-reduced billable IDs | Saved orders now retain the original requested IDs, so fulfilment applies the allowance once to the original selection. |
| Payment-return polling expected IDs that were not part of the paid entitlement | Checkout responses return the canonical billable IDs, including when reusing an open checkout. The browser records those for confirmation polling. |
| Checkout could accept payment while proofing downloads were locked | Server pricing rejects both individual and full-album checkout during the locked proofing stages. |
| Photographer-marked paid photos appeared chargeable in the viewer | The viewer includes the legacy per-photo paid flag in its entitlement set, matching server pricing. |
| Date-only proofing expiry was interpreted as midnight instead of the photographer's end of day | Public gallery data resolves proofing deadlines to an explicit timezone-aware timestamp, as it already does for other expiry fields. |
| Explicit full-album dialog could show the individual selection amount | Dialog identifies the full album, photo count, and applicable price. Purchase-panel amounts use two decimal places. |
| Copying bank details could show success after clipboard failure | Success is shown only after the copy completes. |
| Reusable album card used raw IDs in links | It supports a preferred slug and URL-encodes the identifier. |
| Demo proofing submit button was inert | Empty selections are disabled; submission produces an explicitly labelled local demo confirmation. Changing picks resets it. |

## Validation

- Frontend suite: 31 files, 197 tests passed. The expanded pricing UI regression also passed separately after adding explicit full-album assertions.
- Server suite: 90 tests passed.
- New payment regression exercises mixed free/paid selections and full albums for both main and tenant scopes; valid snapshots pass and incorrect amounts fail.
- New proofing regressions cover locked-stage checkout rejection and timezone-resolved deadlines.
- Type checking, lint, and production build passed during verification.
- Browser: selected a demo proof, submitted, and observed the confirmation and disabled completed button. Desktop visual inspection completed.
- Existing build warnings: stale Browserslist data and an approximately 505 kB admin chunk. These do not block the build.

These are local automated and browser checks. They do not establish successful Stripe-hosted checkout, real webhook transport, bank settlement, mobile Safari downloads, or production custom-domain cookies. No live charge, client notification, or production mutation was performed.

## Remaining priorities

1. **Stripe staging acceptance.** Use a dedicated test-mode account and disposable galleries to run one-photo, mixed free/paid, all-photo individual, and explicit album purchases. Test cancel, declined payment, retry, delayed webhook, duplicate webhook, and return after reload. Confirm exact amount/currency, entitlement IDs, clean original download and ZIP download. Repeat for a tenant and custom domain. Deploy frontend and server changes together; older saved orders do not contain the new original-selection field and remain subject to the existing manual-review safeguards.
2. **Proofing draft persistence.** The real viewer toggles picks in component state until submission. Refreshing can lose unsent picks and notes. Add a round-specific draft with visible saving/saved/error states and safe handling of concurrent sessions. Keep photographer recommendations separate from client selections: the current view uses the same starred flag for both purposes.
3. **Slug integrity.** Public lookup searches IDs and slugs across main and tenant stores, while the admin uniqueness helper checks only the current collection's slugs. This is a structural collision risk, not a demonstrated production collision. Add server-enforced uniqueness against both IDs and slugs in the intended namespace, reject ambiguous updates, and keep redirect aliases when a published slug changes. Tenant-scoped canonical gallery routes would make ownership clearer but require a compatibility migration for existing links and cookies.
4. **Currency consistency.** The gallery UI uses dollar symbols while tenant checkout resolves its own currency. Return a public currency code and format all panel, bank, and confirmation totals consistently. Add tenant currency tests before enabling currencies other than the intended dollar currency.
5. **Responsive and accessibility acceptance.** Run real album flows at phone widths, with keyboard navigation and a screen reader. Check the fixed purchase/proofing bars against image controls, focus restoration in the lightbox, zoom, large galleries, and download progress. The demo is a separate component and is not a substitute for those checks.
6. **Website consistency and loading failures.** Confirm which of the two website implementations is deployed and which host owns booking, portfolio, and galleries. Verify navigation across them, branding, visible empty/error states, and custom-domain links against a staging API. Consolidate duplicated payment dialogs into one component to prevent future pricing drift.

The changes address verified defects; the remaining items are implementation and staging follow-up work, not claims that the entire production toolkit has passed acceptance.

## Follow-up: reliable proofing and purchase recovery

The follow-up implementation supersedes the draft-persistence item above and adds these changes:

- Gallery access and reload responses now return the same server-issued viewer identity. This keeps purchase state and drafts consistent across first access, PIN entry, and reload.
- Client picks and notes are saved locally per album, viewer, and proofing round. A refresh restores them. Submission returns a saved receipt; repeat requests with the same reference return that receipt instead of creating another submission. A page from an older round cannot submit into a newer round.
- Stale main-admin, tenant-admin, and collection saves preserve server-owned purchase records and client submissions. A version-aware save still allows an informed admin to advance or reset proofing.
- Proofing creates a persistent email-notification job alongside the saved submission. Failed delivery retries up to five attempts, and admin proofing panels show queued/sent/failed status. Notification failure does not roll back the client's picks. Existing Discord notification behavior remains.
- Verified Stripe fulfilment stores a normalized purchase email, using customer details and the saved checkout email as fallbacks. Typing another email into the gallery cannot relabel existing paid entitlements. Changed checkout emails cause replacement of a mismatching open checkout rather than reuse.
- The client portal now includes purchaser-only galleries. Its emailed recovery links expire after 30 minutes and restore the union of that buyer's single-photo purchases or full-album access in a cookie-bound session. Typing an email alone never grants access. Recovery respects album, tenant, active account, and expiry boundaries.
- Added a visible Find my purchases form, recovery inbox feedback, a purchased-photo filter, clearer checkout-email copy, simple client selection counts, stable photo order while starring, and Preview labels during locked proofing.

Validation: 199 frontend tests passed; the 98-test server suite passed, and the subsequent notification-delivery regression passed (99 server tests total). Type checking, lint, build, and server syntax checks passed during the follow-up. Browser checks used disposable local fixtures: select/note/refresh/submit/receipt, purchased-photo filtering, and the recovery form at a phone-sized viewport. Fixtures did not send email or call Stripe. Local route tests exercised signed recovery tokens and simulated SMTP failure followed by retry without overwriting newer album data.

Operational limits: changes remain local and need deployment of frontend and server together. Actual SMTP delivery and Stripe webhook transport have not been tested against the deployed environment. Recovery requires a retained purchase record with a trustworthy associated email; historical payments missing that association need reconciliation. Existing approved bank requests without such purchase records are not automatically migrated. Slug namespace collisions and redirect aliases remain separate follow-up work.

# Additional proofing reliability pass — 6 September 2026

Implemented after Stripe sandbox acceptance:

- Submission requests and receipt lookups have bounded timeouts, including response-body reads. When a POST response is lost, the client checks the canonical server receipt before presenting an error. An uncertain outcome keeps the same submission reference available for an explicit retry.
- Submission errors remain visible in the proofing panel. A synchronous in-flight guard prevents rapid repeated clicks from starting concurrent submissions.
- The submit panel follows the canonical album stage, avoiding a prior gallery's submitted flag hiding controls in another gallery. Notes and error state reset when navigating between galleries.
- Mobile proofing has safe-area padding and more space below the photo grid so the submit panel does not obscure the last row.
- Main and tenant admins can retry failed notification delivery from the saved receipt. The endpoint enforces the authenticated scope, leaves selections untouched, and commits the queued state before acknowledging it. Successful notifications are not deliberately resent.
- Notification delivery status now commits durably. Stale admin revisions cannot change proofing state merely by including a copy of the receipt history.

Validation: 202 frontend tests, 101 server tests, typecheck, lint, build, and real-server local staging acceptance passed. Latest local acceptance artifact: `artifacts/staging-llCbI7/results.json`. This pass did not repeat external Stripe payments or deploy production changes.

Remaining release checks are tracked in STAGING.md: hosted HTTPS/proxy behavior, actual remote inbox delivery, delayed/duplicate real Stripe event delivery, and 3-D Secure. A full-app guarantee of no remaining bugs is not established by these checks.
