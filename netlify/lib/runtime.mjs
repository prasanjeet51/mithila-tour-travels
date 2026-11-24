import { getStore } from '@netlify/blobs';
import { createApp } from './app.mjs';

function blobStore() {
  const blobs = getStore({ name: 'mtt', consistency: 'strong' });
  return {
    get: (key) => blobs.get(key, { type: 'json' }),
    set: (key, value) => blobs.setJSON(key, value),
    list: async (prefix) => (await blobs.list({ prefix })).blobs.map((blob) => blob.key),
  };
}

export function handle(req) {
  return createApp({ store: blobStore(), env: process.env }).handle(req);
}
