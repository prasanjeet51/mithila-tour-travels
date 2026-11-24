import { createHmac, timingSafeEqual } from 'node:crypto';

export const STATUSES = ['New', 'Confirmed', 'Completed', 'Cancelled'];
const TRIPS = ['One Way', 'Round Trip', 'Local'];
const CABS = ['Mini', 'Sedan', 'SUV', 'Traveller'];
const NEXT_STATUS = { New: ['Confirmed', 'Cancelled'], Confirmed: ['Completed', 'Cancelled'], Completed: [], Cancelled: [] };
const STATUS_ICON = { New: '🆕', Confirmed: '✅', Completed: '🏁', Cancelled: '❌' };
const SESSION_MS = 12 * 60 * 60 * 1000;
const MAX_LISTED = 300;
const MAX_BODY = 100000;
const TELEGRAM_KEY = 'settings/telegram';

const hmac = (key, message) => createHmac('sha256', key).update(message).digest('hex');
const safeEqual = (a, b) => timingSafeEqual(Buffer.from(hmac('compare', String(a))), Buffer.from(hmac('compare', String(b))));
const text = (value, max) => String(value ?? '').trim().slice(0, max);
const esc = (value) => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

async function readJson(req) {
  const raw = await req.text();
  if (raw.length > MAX_BODY) return null;
  try {
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function parseBooking(data) {
  const booking = {
    ref: text(data.ref, 20),
    trip: text(data.trip, 20),
    pickup: text(data.pickup, 200),
    drop: text(data.drop, 200),
    cab: text(data.cab, 20),
    date: text(data.date, 10),
    time: text(data.time, 5),
    phone: text(data.phone, 10),
    km: Number.isFinite(Number(data.km)) && Number(data.km) > 0 ? Math.round(Number(data.km)) : '',
    route: text(data.route, 500),
  };
  if (!booking.route.startsWith('https://www.google.com/maps/dir/')) booking.route = '';
  if (!/^MTT-[0-9A-Z]{6,12}$/.test(booking.ref)) return { error: 'bad ref' };
  if (!/^\d{10}$/.test(booking.phone)) return { error: 'bad phone' };
  if (!booking.drop) return { error: 'drop is required' };
  if (!TRIPS.includes(booking.trip)) return { error: 'bad trip' };
  if (!CABS.includes(booking.cab)) return { error: 'bad cab' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(booking.date)) return { error: 'bad date' };
  if (!/^\d{2}:\d{2}$/.test(booking.time)) return { error: 'bad time' };
  return { booking };
}

export function createApp({ store, env, fetch: fetchFn = fetch, now = () => Date.now() }) {
  // ---- admin sessions: a signed expiry time, so changing the password ends every session
  const sign = (expires) => hmac(env.ADMIN_PASSWORD, 'session:' + expires);

  function isAdmin(req) {
    if (!env.ADMIN_PASSWORD) return false;
    const [expires, signature] = (req.headers.get('authorization') || '').replace(/^Bearer /, '').split('.');
    return Boolean(signature) && Number(expires) > now() && safeEqual(signature, sign(expires));
  }

  async function login(req) {
    if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD is not set on the server' }, 503);
    const data = await readJson(req);
    if (!data || !safeEqual(data.password ?? '', env.ADMIN_PASSWORD)) return json({ error: 'Wrong password' }, 401);
    const expires = now() + SESSION_MS;
    return json({ token: expires + '.' + sign(expires), expires });
  }

  // ---- bookings
  const bookingKey = (ref) => 'booking/' + ref;

  async function createBooking(req) {
    const data = await readJson(req);
    if (!data) return json({ error: 'bad request' }, 400);
    const { booking, error } = parseBooking(data);
    if (error) return json({ error }, 400);
    if (await store.get(bookingKey(booking.ref))) return json({ error: 'duplicate ref' }, 409);
    const saved = { ...booking, status: 'New', note: '', createdAt: new Date(now()).toISOString() };
    await store.set(bookingKey(saved.ref), saved);
    await notifyChats(saved);
    return json({ ok: true, ref: saved.ref }, 201);
  }

  async function listBookings() {
    const keys = (await store.list('booking/')).sort().reverse().slice(0, MAX_LISTED);
    const bookings = (await Promise.all(keys.map((key) => store.get(key)))).filter(Boolean);
    return bookings.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async function setStatus(ref, status) {
    const booking = await store.get(bookingKey(ref));
    if (!booking) return null;
    const updated = { ...booking, status, updatedAt: new Date(now()).toISOString() };
    await store.set(bookingKey(ref), updated);
    return updated;
  }

  async function updateBooking(req, ref) {
    const data = await readJson(req);
    if (!data) return json({ error: 'bad request' }, 400);
    if (data.status !== undefined && !STATUSES.includes(data.status)) return json({ error: 'bad status' }, 400);
    const booking = await store.get(bookingKey(ref));
    if (!booking) return json({ error: 'not found' }, 404);
    const updated = { ...booking, updatedAt: new Date(now()).toISOString() };
    if (data.status !== undefined) updated.status = data.status;
    if (data.note !== undefined) updated.note = text(data.note, 500);
    await store.set(bookingKey(ref), updated);
    return json({ booking: updated });
  }

  // ---- Telegram bot
  const webhookSecret = () => hmac(env.TELEGRAM_BOT_TOKEN, 'webhook');

  async function telegram(method, payload) {
    if (!env.TELEGRAM_BOT_TOKEN) return null;
    try {
      const res = await fetchFn('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/' + method, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return await res.json();
    } catch (err) {
      console.error('Telegram ' + method + ' failed', err);
      return null;
    }
  }

  async function chats() {
    return (await store.get(TELEGRAM_KEY))?.chats || [];
  }

  function bookingText(b) {
    const lines = [
      STATUS_ICON[b.status] + ' <b>' + esc(b.status) + ' booking ' + esc(b.ref) + '</b>',
      '',
      'Trip: ' + esc(b.trip) + ' · ' + esc(b.cab),
      'From: ' + esc(b.pickup),
      'To: ' + esc(b.drop),
      'When: ' + esc(b.date) + ' ' + esc(b.time),
      'Phone: +91' + esc(b.phone),
    ];
    if (b.km) lines.push('Distance: about ' + esc(b.km) + ' km');
    if (b.note) lines.push('Note: ' + esc(b.note));
    return lines.join('\n');
  }

  function bookingMessage(b) {
    const actions = NEXT_STATUS[b.status].map((status) => ({
      text: STATUS_ICON[status] + ' ' + (status === 'Confirmed' ? 'Confirm' : status === 'Completed' ? 'Complete' : 'Cancel'),
      callback_data: 'status|' + status + '|' + b.ref,
    }));
    const links = [{ text: 'WhatsApp customer', url: 'https://wa.me/91' + b.phone }];
    if (b.route) links.push({ text: 'Route map', url: b.route });
    return {
      text: bookingText(b),
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: actions.length ? [actions, links] : [links] },
    };
  }

  async function notifyChats(booking) {
    for (const chat_id of await chats()) await telegram('sendMessage', { chat_id, ...bookingMessage(booking) });
  }

  async function onMessage(message) {
    const chat_id = message.chat?.id;
    if (chat_id === undefined) return;
    const say = (reply) => telegram('sendMessage', { chat_id, text: reply });
    const [rawCommand, argument] = text(message.text, 300).split(/\s+/);
    const command = (rawCommand || '').split('@')[0];
    const subscribed = (await chats()).includes(chat_id);

    if (command === '/start' && argument) {
      // The message holds the admin password, so remove it from the chat either way.
      await telegram('deleteMessage', { chat_id, message_id: message.message_id });
      if (!env.ADMIN_PASSWORD || !safeEqual(argument, env.ADMIN_PASSWORD)) return say('Wrong password. Send /start followed by the admin password.');
      if (!subscribed) await store.set(TELEGRAM_KEY, { chats: [...(await chats()), chat_id] });
      return say('Connected. Every new booking will arrive here with Confirm and Cancel buttons.\n\n/pending - bookings waiting for you\n/stop - stop these alerts');
    }
    if (!subscribed) return say('This bot is for MTT staff. To connect, send /start followed by the admin password.');
    if (command === '/stop') {
      await store.set(TELEGRAM_KEY, { chats: (await chats()).filter((id) => id !== chat_id) });
      return say('Alerts stopped. Send /start with the admin password to turn them back on.');
    }
    if (command === '/pending') {
      const pending = (await listBookings()).filter((b) => b.status === 'New').slice(0, 10);
      if (!pending.length) return say('No bookings are waiting.');
      for (const booking of pending.reverse()) await telegram('sendMessage', { chat_id, ...bookingMessage(booking) });
      return;
    }
    return say('/pending - bookings waiting for you\n/stop - stop these alerts');
  }

  async function onButton(query) {
    const chat_id = query.message?.chat?.id;
    const answer = (reply) => telegram('answerCallbackQuery', { callback_query_id: query.id, text: reply });
    if (!(await chats()).includes(chat_id)) return answer('Not authorised.');
    const [kind, status, ref] = String(query.data || '').split('|');
    if (kind !== 'status' || !STATUSES.includes(status)) return answer('Unknown action.');
    const booking = await setStatus(ref, status);
    if (!booking) return answer('Booking not found.');
    await answer(ref + ' is now ' + status);
    await telegram('editMessageText', { chat_id, message_id: query.message.message_id, ...bookingMessage(booking) });
  }

  async function webhook(req) {
    if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'not found' }, 404);
    if (!safeEqual(req.headers.get('x-telegram-bot-api-secret-token') || '', webhookSecret())) return json({ error: 'forbidden' }, 403);
    const update = await readJson(req);
    if (update?.message) await onMessage(update.message);
    else if (update?.callback_query) await onButton(update.callback_query);
    return json({ ok: true });
  }

  async function telegramStatus() {
    return json({ configured: Boolean(env.TELEGRAM_BOT_TOKEN), chats: (await chats()).length });
  }

  async function telegramConnect(req) {
    if (!env.TELEGRAM_BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN is not set on the server' }, 503);
    const me = await telegram('getMe', {});
    if (!me?.ok) return json({ error: 'Telegram rejected the bot token' }, 502);
    const hook = await telegram('setWebhook', {
      url: new URL('/api/telegram', req.url).href,
      secret_token: webhookSecret(),
      allowed_updates: ['message', 'callback_query'],
    });
    if (!hook?.ok) return json({ error: 'Telegram could not register the webhook: ' + (hook?.description || 'unknown error') }, 502);
    await telegram('setMyCommands', {
      commands: [
        { command: 'pending', description: 'Bookings waiting for you' },
        { command: 'stop', description: 'Stop booking alerts' },
      ],
    });
    return json({ ok: true, bot: me.result.username, chats: (await chats()).length });
  }

  // ---- router
  async function route(req) {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    const method = req.method;
    if (path === '/api/login' && method === 'POST') return login(req);
    if (path === '/api/bookings' && method === 'POST') return createBooking(req);
    if (path === '/api/telegram' && method === 'POST') return webhook(req);

    const adminRoute = path === '/api/bookings' || path.startsWith('/api/bookings/') || path === '/api/telegram/setup';
    if (!adminRoute) return json({ error: 'not found' }, 404);
    if (!isAdmin(req)) return json({ error: 'unauthorised' }, 401);

    if (path === '/api/bookings' && method === 'GET') return json({ bookings: await listBookings() });
    if (path.startsWith('/api/bookings/') && method === 'PATCH') return updateBooking(req, decodeURIComponent(path.slice('/api/bookings/'.length)));
    if (path === '/api/telegram/setup' && method === 'GET') return telegramStatus();
    if (path === '/api/telegram/setup' && method === 'POST') return telegramConnect(req);
    return json({ error: 'method not allowed' }, 405);
  }

  return {
    async handle(req) {
      try {
        return await route(req);
      } catch (err) {
        console.error(err);
        return json({ error: 'server error' }, 500);
      }
    },
  };
}
