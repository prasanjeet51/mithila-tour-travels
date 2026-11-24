const { test, expect } = require('@playwright/test');

let errors;

test.beforeEach(async ({ page }) => {
  errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Only the local test server is reachable: maps, fonts and place search are blocked.
  await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
  await page.addInitScript(() => {
    window.__opened = [];
    window.open = (url) => { window.__opened.push(url); return null; };
  });
  await page.goto('/');
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
  let saved = 0;
  page.on('request', (r) => { if (r.url().endsWith('/api/bookings')) saved++; });

  await page.locator('#waBook').click();
  await expect(page.locator('#formErr')).toContainText('a drop location');
  await expect(page.locator('#formErr')).toContainText('your mobile number');

  await page.locator('#drop').fill('Patna');
  await page.locator('#phone').fill('12345');
  await page.locator('#waBook').click();
  await expect(page.locator('#formErr')).toContainText('a valid 10-digit mobile number');

  expect(await page.evaluate(() => window.__opened)).toEqual([]);
  expect(saved).toBe(0);
});

test('"Book This Route" fills the form and shows the distance', async ({ page }) => {
  await page.locator('.route', { hasText: 'Muzaffarpur' }).first().getByRole('button').click();
  await expect(page.locator('#pickup')).toHaveValue('Muzaffarpur');
  await expect(page.locator('#drop')).toHaveValue('Patna');
  await expect(page.locator('#fareHint')).toContainText(/about \d+ km/);
  await expect(page.locator('#mapBox')).toBeVisible();
});

test('a booking opens WhatsApp and is saved by the server', async ({ page }) => {
  await page.locator('#pickup').fill('Muzaffarpur');
  await page.locator('#drop').fill('Patna');
  await page.locator('#phone').fill('+91 98765 43210');
  await page.locator('#cabSelect .cabopt[data-v="SUV"]').click();

  const responsePromise = page.waitForResponse((r) => r.url().endsWith('/api/bookings'));
  await page.locator('#waBook').click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const sent = JSON.parse(response.request().postData());

  const opened = await page.evaluate(() => window.__opened);
  expect(opened).toHaveLength(1);
  const text = whatsappText(opened[0]);
  expect(text).toContain('Trip type: One Way');
  expect(text).toContain('Pickup: Muzaffarpur');
  expect(text).toContain('Drop: Patna');
  expect(text).toContain('Cab: SUV');
  expect(text).toContain('My number: 9876543210');
  expect(text).toContain('Route map: https://www.google.com/maps/dir/');

  expect(sent).toMatchObject({ trip: 'One Way', pickup: 'Muzaffarpur', drop: 'Patna', cab: 'SUV', phone: '9876543210' });
  expect(sent.ref).toMatch(/^MTT-[0-9A-Z]+$/);
  expect(text).toContain('Booking ref: ' + sent.ref);
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
