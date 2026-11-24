# Mithila Tour and Travels — Cab Booking

[![Test and deploy](https://github.com/prasanjeet51/mithila-tour-travels/actions/workflows/ci.yml/badge.svg)](https://github.com/prasanjeet51/mithila-tour-travels/actions/workflows/ci.yml)

A booking site, admin panel and Telegram bot for Mithila Tour and Travels, a cab service in Muzaffarpur, Bihar.

**Live site:** https://mttbihar.com

## What it does

**For customers**

- 8 popular city-pair routes across Bihar, plus airport pickup (Patna, Gaya, Darbhanga)
- Cab types: Mini, Sedan, SUV, Traveller; One Way, Round Trip, or Local
- Typo-tolerant place search with a Google Maps route preview and distance
- Booking goes straight to WhatsApp with a booking reference — fares are confirmed there

**For the owner**

- Every booking is saved on the server the moment it is made
- **Admin panel** at `/admin/`: password sign-in, bookings by status, search, notes, one-tap Confirm / Complete /
  Cancel, a ready-written WhatsApp message to the customer, CSV export
- **Telegram bot**: each new booking arrives in Telegram with Confirm and Cancel buttons that update the admin
  panel; `/pending` lists bookings still waiting

## How it works

```
booking form ──> WhatsApp message to the owner
             └─> POST /api/bookings ──> Netlify Function ──> Netlify Blobs (storage)
                                                        └──> Telegram bot alert
admin panel  ──> /api/bookings (signed session) ────────────┘
Telegram buttons ──> /api/telegram webhook ──> booking status updated

git push ──> GitHub Actions: build ──> API tests + browser tests ──> deploy to Netlify
```

| Part | Where |
| --- | --- |
| Site | `template.html`, built into one self-contained page by `scripts/build.js` |
| Admin panel | `admin/index.html` — no framework, renders all customer text as text, never HTML |
| API and bot | `netlify/lib/app.mjs`, exposed by the functions in `netlify/functions/` |
| Tests | `tests/api.test.mjs` (API and bot, Node test runner) and `tests/*.spec.js` (Playwright, desktop and mobile) |
| Pipeline | `.github/workflows/ci.yml` |

Security: the admin password lives only in a Netlify environment variable, sessions are HMAC-signed and expire
after 12 hours, sign-in is rate limited, the Telegram webhook is checked against a secret, and only chats that
sent the admin password can receive bookings or press the buttons.

## Run it locally

Needs Node.js 22 or newer.

```
npm install
npx playwright install chromium
npm test                  # build + API tests + browser tests
node tests/server.mjs     # the site and admin panel on http://localhost:4173 (password: test-password)
```

The local server keeps bookings in memory and never contacts Telegram.

## One-time setup

### 1. Auto-deploy

Add two repository secrets on GitHub (**Settings > Secrets and variables > Actions**):
`NETLIFY_AUTH_TOKEN` (Netlify **User settings > Applications > Personal access tokens**) and
`NETLIFY_SITE_ID` (Netlify site **Site configuration > General > Site details**).

### 2. Admin password

In Netlify, open the site, **Site configuration > Environment variables > Add a variable**:

- `ADMIN_PASSWORD` — a long password of your own. Mark it as secret.

Then redeploy (re-run the latest GitHub Actions run, or push a commit). Sign in at `/admin/`.

### 3. Telegram bot

1. In Telegram, open **@BotFather**, send `/newbot` and follow the steps. Copy the bot token it gives you.
2. In Netlify, add the environment variable `TELEGRAM_BOT_TOKEN` with that token (mark it as secret) and redeploy.
3. Sign in to `/admin/` and press **Connect Telegram bot**.
4. Open your bot in Telegram and send `/start` followed by the admin password, for example `/start my-password`.
   The bot deletes that message and confirms. Anyone else who should get bookings does the same.

## Built by

Kumar Prasanjeet — https://portfolio-six-rust-xxevi400ba.vercel.app
