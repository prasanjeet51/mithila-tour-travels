const { test, expect } = require('@playwright/test');

function newBooking(extra) {
  const ref = 'MTT-' + Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(8, 'X');
  return { ref, trip: 'One Way', pickup: 'Muzaffarpur', drop: 'Patna', cab: 'Sedan', date: '2026-12-01', time: '09:30', phone: '9876543210', km: 80, route: '', ...extra };
}

async function signIn(page) {
  await page.goto('/admin/');
  await page.locator('#password').fill('test-password');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#panel')).toBeVisible();
}

test('a wrong password is refused', async ({ page }) => {
  await page.goto('/admin/');
  await page.locator('#password').fill('not-the-password');
  await page.locator('#loginBtn').click();
  await expect(page.locator('#loginErr')).toHaveText('Wrong password');
  await expect(page.locator('#panel')).toBeHidden();
});

test('a booking shows up in the panel and can be confirmed', async ({ page, request }) => {
  const booking = newBooking();
  expect((await request.post('/api/bookings', { data: booking })).status()).toBe(201);

  await signIn(page);
  await page.locator('#search').fill(booking.ref);
  const card = page.locator('.card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.chip')).toHaveText('New');
  await expect(card).toContainText('Muzaffarpur → Patna');

  await card.getByRole('button', { name: 'Confirm' }).click();
  await expect(card.locator('.chip')).toHaveText('Confirmed');

  await card.locator('textarea').fill('Driver Raju');
  await card.locator('textarea').blur();

  await page.reload();
  await page.locator('#search').fill(booking.ref);
  await expect(page.locator('.card .chip')).toHaveText('Confirmed');
  await expect(page.locator('.card textarea')).toHaveValue('Driver Raju');
  await expect(page.locator('.card').getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', /wa\.me\/919876543210\?text=.*confirmed/);
});

test('booking text from the public form is never run as HTML', async ({ page, request }) => {
  const booking = newBooking({ pickup: '<img src=x onerror="window.__xss=1">' });
  await request.post('/api/bookings', { data: booking });

  await signIn(page);
  await page.locator('#search').fill(booking.ref);
  await expect(page.locator('.card .route')).toContainText('<img src=x');
  expect(await page.evaluate(() => window.__xss)).toBeUndefined();
});

test('the bookings API is closed without signing in', async ({ request }) => {
  expect((await request.get('/api/bookings')).status()).toBe(401);
});
