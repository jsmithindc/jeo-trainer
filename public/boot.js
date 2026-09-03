// Kept out of index.html so the Content-Security-Policy can forbid inline scripts
// outright rather than allowing them all to permit this one.

// Reveal the app once the webfonts are ready, to avoid a flash of fallback type.
document.fonts.ready.then(() => document.documentElement.classList.add('fonts-loaded'))
setTimeout(() => document.documentElement.classList.add('fonts-loaded'), 500)

// Pick up a new deploy promptly, without reloading for no reason.
//
// skipWaiting + clientsClaim mean a new service worker takes control as soon as it
// installs, which fires controllerchange. Reloading on that is right when a worker
// *replaces* one that was already running: the page is executing superseded code.
//
// It is wrong on a first visit. There, the very first worker claims the page it was just
// registered from — the page is already the newest code, and the reload only makes the
// user watch the app start twice. That is what they saw: loading screen, a flash of the
// board, loading screen again, then the board. `hadController` tells the two apart —
// nothing was controlling this page when it loaded, so nothing was superseded.
//
// The app also sets window.__jeoBusy while a game or study session is running. A board
// autosaves and would survive a reload; a session's position lives only in memory, so the
// reload is deferred and the next ordinary navigation picks up the new page.
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller
  let reloading = false

  navigator.serviceWorker.getRegistrations().then(regs => regs.forEach(reg => reg.update()))

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return              // first install claiming us; nothing to reload for
    if (reloading) return                   // controllerchange can fire more than once
    if (window.__jeoBusy) { window.__jeoUpdatePending = true; return }
    reloading = true
    window.location.reload()
  })
}
