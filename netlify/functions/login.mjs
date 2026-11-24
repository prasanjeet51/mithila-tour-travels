import { handle } from '../lib/runtime.mjs';

export default handle;

// Tight limit: this is the only place the admin password can be guessed.
export const config = {
  path: '/api/login',
  rateLimit: { action: 'rate_limit', aggregateBy: ['ip', 'domain'], windowSize: 60, windowLimit: 5 },
};
