export function memoryStore() {
  const data = new Map();
  return {
    get: async (key) => (data.has(key) ? JSON.parse(data.get(key)) : null),
    set: async (key, value) => { data.set(key, JSON.stringify(value)); },
    list: async (prefix) => [...data.keys()].filter((key) => key.startsWith(prefix)),
  };
}
