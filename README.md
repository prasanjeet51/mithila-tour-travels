# Mithila Tour and Travels — Cab Booking

[![Test and deploy](https://github.com/prasanjeet51/mithila-tour-travels/actions/workflows/ci.yml/badge.svg)](https://github.com/prasanjeet51/mithila-tour-travels/actions/workflows/ci.yml)

A booking site for Mithila Tour and Travels, a cab service in Muzaffarpur, Bihar.

**Live site:** https://warm-pithivier-b7a79e.netlify.app/

## What it does

- 8 popular city-pair routes across Bihar, plus airport pickup (Patna, Gaya, Darbhanga)
- Cab types: Mini, Sedan, SUV, Traveller
- One Way, Round Trip, or Local
- Typo-tolerant place search with a Google Maps route preview and distance
- Booking goes straight to WhatsApp — fares are confirmed there, no prices on the site
- Every booking is also saved as a row in the owner's Google Sheet

## Automation

| What | How |
| --- | --- |
| Build | `scripts/build.js` turns `template.html` into a single self-contained `dist/index.html` |
| Tests | Playwright runs the booking flow in desktop and mobile Chrome, with the network mocked |
| CI/CD | GitHub Actions builds and tests every push and pull request; a green `main` is deployed to Netlify |
| Booking log | The page posts each booking to a Google Apps Script web app, which appends it to a Google Sheet |

```
push to main -> build -> Playwright tests -> deploy to Netlify
booking form -> WhatsApp message to the owner
             -> Google Apps Script -> Google Sheet row (+ optional email)
```

## Run it locally

Needs Node.js 22 or newer.

```
npm install
npx playwright install chromium
npm run build     # writes dist/index.html
npm test
```

Open `dist/index.html` in a browser to see the site.

## Files

- `template.html` — the page source; edit this, not `dist/`
- `assets/` — logo, cab photos and route photos
- `site.config.json` — the booking log URL
- `scripts/build.js` — the build
- `tests/` — Playwright tests
- `apps-script/Code.gs` — the Google Sheet booking log
- `.github/workflows/ci.yml` — the pipeline

## One-time setup

### Auto-deploy to Netlify

1. In Netlify: **User settings > Applications > Personal access tokens > New access token**. Copy it.
2. In Netlify: open the site, **Site configuration > General > Site details**. Copy the **Site ID**.
3. In the GitHub repository: **Settings > Secrets and variables > Actions > New repository secret**. Add
   `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`.

Until both secrets exist, the pipeline still builds and tests but skips the deploy.

### Booking log in Google Sheets

1. Create a new Google Sheet.
2. **Extensions > Apps Script**. Replace the code with `apps-script/Code.gs` and save.
3. **Deploy > New deployment > Web app**. Set **Execute as: Me** and **Who has access: Anyone**. Authorise it and
   copy the web app URL.
4. Paste the URL into `site.config.json` as `bookingEndpoint`, then commit and push.

Bookings then appear in a `Bookings` tab. To also get an email for each one, set `NOTIFY_EMAIL` in the script and
deploy a new version.

## Built by

Kumar Prasanjeet — https://portfolio-six-rust-xxevi400ba.vercel.app
