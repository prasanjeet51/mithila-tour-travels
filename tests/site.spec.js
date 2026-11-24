const path = require('path');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');

const PAGE = pathToFileURL(path.join(__dirname, '..', '.test-dist', 'index.html')).href;

let errors, logged;

test.beforeEach(async ({ page }) => {
  errors = [];
  logged = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // No test touches the real network: the booking log is captured, everything else external is blocked.
  await page.route(/^https?:\/\//, (route) => {
    const req = route.request();
    if (req.url() === 'https://bookings.test/hook') {
      logged.push(JSON.parse(req.postData()));
      return route.fulfill({ status: 200, body: '{"ok":true}' });
    }
    return route.abort();
  });
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return null; };
  });
  await page.goto(PAGE);
});

test.afterEach(() => {
  expect(errors, 'JavaScript errors on the page').toEqual([]);
});

function whatsappText(url) {
  expect(url.startsWith('https://wa.me/917004480793?text=')).toBe(true);
  return new URL(url).searchParams.get('text');
}

test('page renders routes, fleet and a pre-filled date', async ({ page }) => {
  await expect(page).toHaveTitle(/Mithila Tour and Travels/);
  await expect(page.locator('.route')).toHaveCount(9);
  await expect(page.locator('#cabGrid .cab')).toHaveCount(4);
  await expect(page.locator('#date')).not.toHaveValue('');
  await expect(page.locator('#time')).not.toHaveValue('');
});

test('every image on the page loads', async ({ page }) => {
  await page.evaluate(() => document.querySelectorAll('img').forEach((img) => { img.loading = 'eager'; }));
  await expect
    .poll(() => page.evaluate(() => [...document.images].filter((i) => !i.complete || !i.naturalWidth).map((i) => i.alt)))
    .toEqual([]);
});

test('booking is refused until drop and a valid phone are given', async ({ page }) => {
  await page.locator('#waBook').click();
  await expect(page.locator('#formErr')).toContainText('a drop location');
  await expect(page.locator('#formErr')).toContainText('your mobile number');

  await page.locator('#drop').fill('Patna');
  await page.locator('#phone').fill('12345');
  await page.locator('#waBook').click();
  await expect(page.locator('#formErr')).toContainText('a valid 10-digit mobile number');

  expect(await page.evaluate(() => window.__opened)).toEqual([]);
  expect(logged).toEqual([]);
});

test('"Book This Route" fills the form and shows the distance', async ({ page }) => {
  await page.locator('.route', { hasText: 'Muzaffarpur' }).first().getByRole('button').click();
  await expect(page.locator('#pickup')).toHaveValue('Muzaffarpur');
  await expect(page.locator('#drop')).toHaveValue('Patna');
  await expect(page.locator('#fareHint')).toContainText(/about \d+ km/);
  await expect(page.locator('#mapBox')).toBeVisible();
});

test('a booking opens WhatsApp and is saved to the booking log', async ({ page }) => {
  await page.locator('#pickup').fill('Muzaffarpur');
  await page.locator('#drop').fill('Patna');
  await page.locator('#phone').fill('+91 98765 43210');
  await page.locator('#cabSelect .cabopt[data-v="SUV"]').click();
  await page.locator('#waBook').click();

  await expect.poll(() => logged.length).toBe(1);
  const opened = await page.evaluate(() => window.__opened);
  expect(opened).toHaveLength(1);

  const text = whatsappText(opened[0]);
  expect(text).toContain('Trip type: One Way');
  expect(text).toContain('Pickup: Muzaffarpur');
  expect(text).toContain('Drop: Patna');
  expect(text).toContain('Cab: SUV');
  expect(text).toContain('My number: 9876543210');
  expect(text).toContain('Route map: https://www.google.com/maps/dir/');

  expect(logged[0]).toMatchObject({ trip: 'One Way', pickup: 'Muzaffarpur', drop: 'Patna', cab: 'SUV', phone: '9876543210' });
  expect(logged[0].ref).toMatch(/^MTT-[0-9A-Z]+$/);
  expect(text).toContain('Booking ref: ' + logged[0].ref);
});

test('a picked suggestion sends its exact coordinates in the route link', async ({ page }) => {
  await page.locator('#pickup').focus();
  await page.locator('#pickupSugg .sugg-item', { hasText: 'Ahiyapur' }).dispatchEvent('mousedown');
  await expect(page.locator('#pickup')).toHaveValue('Ahiyapur, Muzaffarpur');
  await page.locator('#drop').fill('Patna');
  await page.locator('#phone').fill('9876543210');
  await page.locator('#waBook').click();

  const opened = await page.evaluate(() => window.__opened);
  expect(whatsappText(opened[0])).toContain('origin=' + encodeURIComponent('26.13,85.38'));
});
