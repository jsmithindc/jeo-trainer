// Turns whatever a failed sync threw into something the banner can act on.
//
// supabase-js reports a dropped connection as a PostgREST error whose message is the
// fetch failure's name and text — "TypeError: NetworkError when attempting to fetch
// resource." in Firefox and Zen, "TypeError: Load failed" in Safari, "TypeError: Failed
// to fetch" in Chrome. That is the "type error" that used to stick on screen until a
// sign-out: it is a lost connection, and the next push usually succeeds.
export function describeSyncError(err) {
  const raw = (typeof err === 'string' ? err : err?.message) || 'Unknown sync error'
  const auth = err?.auth === true || err?.status === 401 ||
    /jwt|refresh token|session (missing|expired|not found)|signed out|not authenticated/i.test(raw)
  const offline = !auth && /fetch|network|load failed|timed? ?out|offline/i.test(raw)
  return { raw, auth, offline }
}
