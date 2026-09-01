const { createClient } = await import('@supabase/supabase-js')
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { locks: { request: async (n, o, cb) => o.ifAvailable ? cb(null) : cb({ name: n }) } },
})
Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener(){}, removeEventListener(){}, location:{href:'http://x'} } })
Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener(){}, removeEventListener(){}, visibilityState:'visible' } })

const calls = []
const myLock = async (name, timeout, fn) => { calls.push(timeout); return fn() }
const c = createClient('https://x.supabase.co', 'k', { auth: { lock: myLock } })
console.log('client.auth.lock is mine? ', c.auth.lock === myLock)
console.log('lock invoked with timeouts:', JSON.stringify(calls))
