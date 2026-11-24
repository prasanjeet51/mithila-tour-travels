import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../netlify/lib/app.mjs';
import { memoryStore } from './memory-store.mjs';

const BOT_TOKEN = '123:test-token';
const WEBHOOK_SECRET = createHmac('sha256', BOT_TOKEN).update('webhook').digest('hex');
const BOOKING = { ref: 'MTT-TEST0001', trip: 'One Way', pickup: 'Muzaffarpur', drop: 'Patna', cab: 'SUV', date: '2026-12-01', time: '09:30', phone: '9876543210', km: 80, route: 'https://www.google.com/maps/dir/?api=1&origin=a&destination=b' };

function setup({ telegram = true } = {}) {
  const sent = [];
  let clock = Date.parse('2026-11-25T10:00:00Z');
  const env = { ADMIN_PASSWORD: 'secret-pass' };
  if (telegram) env.TELEGRAM_BOT_TOKEN = BOT_TOKEN;
  const app = createApp({
    store: memoryStore(),
    env,
    now: () => clock,
    fetch: async (url, options) => {
      sent.push({ method: url.split('/').pop(), ...JSON.parse(options.body) });
      return new Response(JSON.stringify({ ok: true, result: { username: 'mtt_test_bot' } }));
    },
  });
  const call = async (method, path, body, headers = {}) => {
    const res = await app.handle(new Request('https://mtt.test' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  const login = async () => ({ authorization: 'Bearer ' + (await call('POST', '/api/login', { password: 'secret-pass' })).body.token });
  const tg = (update, secret = WEBHOOK_SECRET) => call('POST', '/api/telegram', update, { 'x-telegram-bot-api-secret-token': secret });
  return { call, login, tg, sent, advance: (ms) => { clock += ms; } };
}

test('a valid booking is saved as New', async () => {
  const { call, login } = setup();
  assert.equal((await call('POST', '/api/bookings', BOOKING)).status, 201);
  const { body } = await call('GET', '/api/bookings', undefined, await login());
  assert.equal(body.bookings.length, 1);
  assert.deepEqual({ ref: body.bookings[0].ref, status: body.bookings[0].status, phone: body.bookings[0].phone }, { ref: 'MTT-TEST0001', status: 'New', phone: '9876543210' });
});

test('invalid bookings are rejected', async () => {
  const { call } = setup();
  for (const bad of [{ phone: '12345' }, { ref: 'nope' }, { drop: '  ' }, { cab: 'Helicopter' }, { trip: 'Sideways' }, { date: 'tomorrow' }]) {
    assert.equal((await call('POST', '/api/bookings', { ...BOOKING, ...bad })).status, 400, JSON.stringify(bad));
  }
});

test('a booking ref cannot be reused to overwrite a booking', async () => {
  const { call } = setup();
  await call('POST', '/api/bookings', BOOKING);
  assert.equal((await call('POST', '/api/bookings', { ...BOOKING, drop: 'Gaya' })).status, 409);
});

test('a route link that is not Google Maps is dropped', async () => {
  const { call, login } = setup();
  await call('POST', '/api/bookings', { ...BOOKING, route: 'javascript:alert(1)' });
  assert.equal((await call('GET', '/api/bookings', undefined, await login())).body.bookings[0].route, '');
});

test('admin routes need a valid, unexpired session', async () => {
  const { call, login, advance } = setup();
  assert.equal((await call('GET', '/api/bookings')).status, 401);
  assert.equal((await call('GET', '/api/bookings', undefined, { authorization: 'Bearer 99999999999999.forged' })).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'wrong' })).status, 401);
  const auth = await login();
  assert.equal((await call('GET', '/api/bookings', undefined, auth)).status, 200);
  advance(13 * 60 * 60 * 1000);
  assert.equal((await call('GET', '/api/bookings', undefined, auth)).status, 401);
});

test('admin can change status and note, but not to an unknown status', async () => {
  const { call, login } = setup();
  const auth = await login();
  await call('POST', '/api/bookings', BOOKING);
  const updated = await call('PATCH', '/api/bookings/MTT-TEST0001', { status: 'Confirmed', note: 'Driver Raju' }, auth);
  assert.deepEqual([updated.body.booking.status, updated.body.booking.note], ['Confirmed', 'Driver Raju']);
  assert.equal((await call('PATCH', '/api/bookings/MTT-TEST0001', { status: 'Hacked' }, auth)).status, 400);
  assert.equal((await call('PATCH', '/api/bookings/MTT-NOPE0000', { status: 'Confirmed' }, auth)).status, 404);
  assert.equal((await call('PATCH', '/api/bookings/MTT-TEST0001', { status: 'Cancelled' })).status, 401);
});

test('Telegram webhook rejects a wrong secret', async () => {
  const { tg, sent } = setup();
  assert.equal((await tg({ message: { chat: { id: 5 }, message_id: 1, text: '/pending' } }, 'wrong')).status, 403);
  assert.equal(sent.length, 0);
});

test('Telegram: only /start with the admin password subscribes a chat', async () => {
  const { call, tg, sent } = setup();
  await tg({ message: { chat: { id: 5 }, message_id: 1, text: '/start guess' } });
  await call('POST', '/api/bookings', BOOKING);
  assert.equal(sent.filter((m) => m.method === 'sendMessage' && m.text.includes('MTT-TEST0001')).length, 0);

  await tg({ message: { chat: { id: 5 }, message_id: 2, text: '/start secret-pass' } });
  assert.ok(sent.some((m) => m.method === 'deleteMessage' && m.message_id === 2), 'the password message is deleted');
  await call('POST', '/api/bookings', { ...BOOKING, ref: 'MTT-TEST0002' });
  const alert = sent.find((m) => m.method === 'sendMessage' && m.text.includes('MTT-TEST0002'));
  assert.equal(alert.chat_id, 5);
  assert.deepEqual(alert.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ['status|Confirmed|MTT-TEST0002', 'status|Cancelled|MTT-TEST0002']);
});

test('Telegram: the Confirm button updates the booking, but only for a subscribed chat', async () => {
  const { call, login, tg, sent } = setup();
  await tg({ message: { chat: { id: 5 }, message_id: 1, text: '/start secret-pass' } });
  await call('POST', '/api/bookings', BOOKING);
  const status = async () => (await call('GET', '/api/bookings', undefined, await login())).body.bookings[0].status;

  await tg({ callback_query: { id: 'a', data: 'status|Confirmed|MTT-TEST0001', message: { chat: { id: 666 }, message_id: 9 } } });
  assert.equal(await status(), 'New');

  await tg({ callback_query: { id: 'b', data: 'status|Confirmed|MTT-TEST0001', message: { chat: { id: 5 }, message_id: 9 } } });
  assert.equal(await status(), 'Confirmed');
  const edit = sent.find((m) => m.method === 'editMessageText');
  assert.ok(edit.text.includes('Confirmed booking MTT-TEST0001'));
  assert.deepEqual(edit.reply_markup.inline_keyboard[0].map((b) => b.callback_data), ['status|Completed|MTT-TEST0001', 'status|Cancelled|MTT-TEST0001']);
});

test('Telegram: customer text is escaped in alerts', async () => {
  const { call, tg, sent } = setup();
  await tg({ message: { chat: { id: 5 }, message_id: 1, text: '/start secret-pass' } });
  await call('POST', '/api/bookings', { ...BOOKING, pickup: '<b>x</b> & co' });
  assert.ok(sent.at(-1).text.includes('From: &lt;b&gt;x&lt;/b&gt; &amp; co'));
});

test('Telegram: /pending lists waiting bookings and /stop ends alerts', async () => {
  const { call, tg, sent } = setup();
  await tg({ message: { chat: { id: 5 }, message_id: 1, text: '/start secret-pass' } });
  await call('POST', '/api/bookings', BOOKING);
  sent.length = 0;
  await tg({ message: { chat: { id: 5 }, message_id: 2, text: '/pending' } });
  assert.equal(sent.filter((m) => m.text?.includes('MTT-TEST0001')).length, 1);
  await tg({ message: { chat: { id: 5 }, message_id: 3, text: '/stop' } });
  sent.length = 0;
  await call('POST', '/api/bookings', { ...BOOKING, ref: 'MTT-TEST0003' });
  assert.equal(sent.length, 0);
});

test('connecting the bot registers the webhook on this site with the secret', async () => {
  const { call, login, sent } = setup();
  const res = await call('POST', '/api/telegram/setup', undefined, await login());
  assert.equal(res.body.bot, 'mtt_test_bot');
  const hook = sent.find((m) => m.method === 'setWebhook');
  assert.deepEqual([hook.url, hook.secret_token], ['https://mtt.test/api/telegram', WEBHOOK_SECRET]);
});

test('without a bot token bookings still save and the webhook is closed', async () => {
  const { call, tg, sent } = setup({ telegram: false });
  assert.equal((await call('POST', '/api/bookings', BOOKING)).status, 201);
  assert.equal((await tg({ message: { chat: { id: 5 }, text: '/pending' } })).status, 404);
  assert.equal(sent.length, 0);
});
