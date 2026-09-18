// CPU watchdog for the local preview's scene server (hammurabi-server).
//
// Preloaded into every node process `npm start` spawns via NODE_OPTIONS (see package.json
// "start"), because the SDK launches the server through npx and passes its environment
// through untouched. It ARMS ONLY inside the hammurabi-server process — npm, sdk-commands
// (which may run a CPU-heavy build) and the npx wrapper see a no-op.
//
// If the server burns >80% of one core for 15 s straight it exits, before a runaway can
// freeze KJ's iMac (it did, twice, on 2026-09-16). Moved here from the old hammurabi.mjs
// preloader when the preview switched to the stock server (2026-09-18).

// argv[1] is the script node runs: .../.bin/hammurabi-server for the server itself. The npx
// wrapper runs npx-cli.js with '@dcl/hammurabi-server@next' only as a later argument.
const isSceneServer = /[\\/]hammurabi-server([\\/]dist[\\/]cli\.js)?$/.test(process.argv[1] ?? '')

if (isSceneServer) {
  const CHECK_MS     = 3_000
  const THRESHOLD_US = CHECK_MS * 1_000 * 0.80   // 80% of one core, in µs
  const MAX_STRIKES  = 5                          // 5 × 3 s = 15 s sustained
  let lastUsage = process.cpuUsage()
  let strikes   = 0

  const timer = setInterval(() => {
    const delta = process.cpuUsage(lastUsage)
    lastUsage   = process.cpuUsage()
    const total = delta.user + delta.system
    if (total > THRESHOLD_US) {
      strikes++
      console.error(`[Watchdog] High CPU: ${Math.round(total / 1000)}ms in last 3s (strike ${strikes}/${MAX_STRIKES})`)
      if (strikes >= MAX_STRIKES) {
        console.error('[Watchdog] CPU limit exceeded — shutting down to protect the system. Restart with npm start.')
        clearInterval(timer)
        process.exit(1)
      }
    } else {
      strikes = 0
    }
  }, CHECK_MS)
  timer.unref()   // never keeps the process alive on its own

  console.log('[Watchdog] armed in scene server (pid ' + process.pid + ')')
}
