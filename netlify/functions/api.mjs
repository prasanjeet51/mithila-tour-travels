import { handle } from '../lib/runtime.mjs';

export default handle;

export const config = {
  path: ['/api/bookings', '/api/bookings/:ref', '/api/telegram', '/api/telegram/setup'],
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 60 },
};
