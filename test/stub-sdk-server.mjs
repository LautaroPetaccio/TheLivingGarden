// Stands in for @dcl/sdk/server's Storage so persistence.ts can be exercised off-world.
// Records every call and lets a test decide what each one returns.

export const calls = []

let handler = { get: () => null, set: () => true }

/** Replace part or all of the behaviour. Handlers receive the call description. */
export function setHandler(h) { handler = { ...handler, ...h } }

export const Storage = {
  async get(key, options) {
    calls.push({ op: 'get', scope: 'scene', key, options })
    return handler.get({ scope: 'scene', key, options })
  },
  async set(key, value, options) {
    calls.push({ op: 'set', scope: 'scene', key, value, options })
    return handler.set({ scope: 'scene', key, value, options })
  },
  player: {
    async get(address, key, options) {
      calls.push({ op: 'get', scope: 'player', address, key, options })
      return handler.get({ scope: 'player', address, key, options })
    },
    async set(address, key, value, options) {
      calls.push({ op: 'set', scope: 'player', address, key, value, options })
      return handler.set({ scope: 'player', address, key, value, options })
    },
  },
}
