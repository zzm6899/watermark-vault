# Tenant integration setup and acceptance checks

Use `/tenant-admin/YOUR-SLUG` and that tenant's Settings. Replace `https://your-domain.com` below with the public HTTPS application origin. Repeat setup independently for each tenant; platform credentials do not configure tenant payments, email, Discord, or Google Calendar.

## Stripe

1. Open the intended tenant's Stripe account in test mode. Copy its publishable (`pk_test_…`) and secret (`sk_test_…`) API keys into the tenant's Stripe settings, enable Stripe, and select the currency (AUD for Australian dollars).
2. In Stripe's webhook destinations, register `https://your-domain.com/api/tenant/YOUR-SLUG/stripe/webhook` for `checkout.session.completed`.
3. Copy that destination's signing secret (`whsec_…`) into the tenant's webhook-secret field and save. The secret must belong to this exact endpoint and environment. Without it, tenant card checkout is unavailable; the platform's unsigned-webhook development flag does not bypass this requirement.
4. Create a test booking from this tenant's public page and complete checkout in Stripe test mode. Confirm payment appears only on this tenant's booking, then test a gallery purchase and download access. A generic Stripe sample event cannot fulfil a real booking without the checkout's server-side snapshot.
5. Check Stripe's delivery log for a successful response. A signature error means the endpoint secret, raw payload, or environment is wrong. A payment flagged for review means the canonical amount, selection, or booking changed; review before granting access.
6. Before production, replace both API keys and the endpoint signing secret with their live equivalents from the same tenant account. Register the same endpoint in live mode. Never combine test and live credentials.

This application fulfils paid `checkout.session.completed` events. Delayed-payment event fulfilment is not implemented; keep this deployment on its existing card checkout flow. [Stripe webhook setup and signatures](https://docs.stripe.com/webhooks).

## Email / SMTP

1. Obtain SMTP host, port, username, and password (or provider app password) for the tenant's sender.
2. Enter them under tenant Email/SMTP. Use port 465 with the TLS switch enabled for implicit TLS, or the provider's port 587 with that switch disabled for STARTTLS.
3. Set the From address to a sender your provider authorizes. Save. Missing tenant SMTP credentials disable tenant mail; they must not use the platform mailbox.
4. In a test tenant with a mailbox you control, request a booking receipt and gallery recovery email. Verify the sender, branding, links, and tenant-specific gallery access. Provider DNS/sender verification and actual delivery must be checked with the SMTP provider.

## Discord

1. In the tenant's intended Discord channel, create a webhook under channel integrations and copy its URL.
2. Save it in the tenant's Discord integration and enable the desired notification types.
3. Create a test booking or request. Verify that only the tenant's channel receives it.
4. Remove the tenant webhook and repeat: the platform channel must receive nothing. The URL is a secret; use a different webhook for each tenant and replace leaked URLs in Discord and tenant settings.

## Google Calendar

1. Create or choose the tenant's Google Cloud project, enable the Google Calendar API, and configure OAuth consent (including test users if the consent app remains in testing).
2. Create an OAuth client of type **Web application**. Register this exact authorized redirect URI: `https://your-domain.com/api/tenant/YOUR-SLUG/integrations/googlecalendar/callback`.
3. Download the OAuth client JSON containing its `web` object and paste it into the tenant's Google API Credentials field; save. Use a JSON configuration whose Calendar callback matches this tenant, rather than a list whose first Calendar callback belongs to another tenant.
4. Click Connect Google Calendar while signed in to this tenant's admin. Authorize the intended Google account, choose its calendar, and enable automatic sync if wanted.
5. Create an eligible test booking, then reschedule and cancel it. Confirm all changes land in this tenant's selected calendar only. Disconnecting one tenant should leave the other connected.

Google requires the redirect URI used by the app to match a configured URI. [Google web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server).

## Two-tenant release check

Use two test tenants with separate test Stripe accounts, mailboxes, Discord channels, and calendars. In separate browser profiles, operate both tenants concurrently. Verify bookings, gallery uploads/downloads, email recovery, watermarks, and integration messages remain tenant-specific. Repeat the same tenant sign-in and gallery workflow on the built Android APK against the intended server.

The automated integration checks run with `node --test server/test/tenant-integrations.test.js server/test/stripe.test.js server/test/email.test.js`. They check independent SMTP configuration, failure when an explicit tenant transport is missing, simultaneous tenant signature verification, wrong-tenant webhook signatures, unsigned tenant webhook rejection, and cross-tenant booking checkout rejection. They use local HTTP and synthetic Stripe signatures; they do not send mail, make payments, contact Google/Discord, or run an Android device. Provider delivery, OAuth consent, account permissions, and APK runtime behavior require the release checks above.
