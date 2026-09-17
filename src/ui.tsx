// =============================================================
// The Living Garden — Screen UI
//
// Layers
//   Persistent   — bottom-centre, stays until cleared
//   Daily Limit  — bottom-centre, player-dismissible
//   Toast        — bottom-centre, auto-dismiss
//   Banner       — top-centre, garden status, always dark
//   Health Bar   — right-centre, vertical bar mimicking 3D boards
// =============================================================

import ReactEcs, { ReactEcsRenderer, UiEntity, Label } from '@dcl/sdk/react-ecs'
import { TestPanelUi } from './testPanel'
import { readCanvasInfo, getSafeArea, getScreenInsets, pct } from './safeArea'
import { isMobile } from '@dcl/sdk/platform'
import { Color4 } from '@dcl/sdk/math'
import { engine, timers } from '@dcl/sdk/ecs'

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

let toastVisible  = false
let toastText     = ''
let toastLarge    = false
let toastGen      = 0

let dailyLimitVisible = false
let dailyLimitText    = ''

let persistVisible = false
let persistText    = ''

type BannerState = 'idle' | 'countdown' | 'bloom'
let bannerState:    BannerState = 'idle'
let bannerCountdown = ''   // e.g. "3h 42m 15s" — always kept current by ticker
let bannerVisible   = true // player can dismiss; auto-restores on bloom/countdown
let bannerHealth    = 0    // 0–1 — drives the right-hand side bar
let playerCount     = 0

// Banner animation
let bannerOffsetY = 0   // slide-in from top


function animateBannerIn(): void {
  const STEPS   = 10
  const STEP_MS = 25
  let step = 0
  bannerOffsetY = -20
  function tick(): void {
    step++
    const t      = step / STEPS
    const eased  = 1 - (1 - t) * (1 - t)   // ease-out quad
    bannerOffsetY = Math.round(-20 * (1 - eased))
    if (step < STEPS) timers.setTimeout(tick, STEP_MS)
    else bannerOffsetY = 0
  }
  timers.setTimeout(tick, STEP_MS)
}


// ---------------------------------------------------------------
// Public API — bottom pills
// ---------------------------------------------------------------

export function showToast(text: string, durationMs: number, large = false): void {
  toastText    = text
  toastLarge   = large
  toastVisible = true
  const gen    = ++toastGen
  timers.setTimeout(() => { if (toastGen === gen) toastVisible = false }, durationMs)
}

export function showDailyLimit(text: string): void {
  dailyLimitText    = text
  dailyLimitVisible = true
}
export function hideDailyLimit(): void { dailyLimitVisible = false }

export function showPersistent(text: string): void {
  persistText    = text
  persistVisible = true
}
export function hidePersistent(): void { persistVisible = false }

// ---------------------------------------------------------------
// Public API — top banner
// ---------------------------------------------------------------

export function showBannerIdle(): void  { bannerState = 'idle' }
let bannerBloomLabel = ''   // Phase 6: variant / scale-aware headline; '' = default
export function showBannerBloom(label = ''): void { bannerBloomLabel = label; bannerState = 'bloom'; bannerVisible = true; animateBannerIn() }

export function showBannerCountdown(countdown: string): void {
  const wasCountdown = bannerState === 'countdown'
  bannerState     = 'countdown'
  bannerCountdown = countdown
  bannerVisible   = true
  if (!wasCountdown) {
    animateBannerIn()
  }
}
export function updateBannerCountdown(countdown: string): void {
  bannerCountdown = countdown
}
function hideBanner(): void { bannerVisible = false }

// ---------------------------------------------------------------
// Public API — side health bar
// ---------------------------------------------------------------

/** Update the vertical health bar (0–1). Call whenever wateredCount changes. */
export function updateBannerHealth(ratio: number): void {
  bannerHealth = Math.max(0, Math.min(1, ratio))
}

/** Update the player count label. */
export function updatePlayerCount(n: number): void {
  playerCount = n
}

/** Update the top-left waters-remaining counter. */



// ---------------------------------------------------------------
// Layout constants  (virtual canvas 1920 × 1080)
// ---------------------------------------------------------------

const DARK         = { r: 0.13, g: 0.13, b: 0.13, a: 0.88 }   // DCL default dark
const WHITE   = Color4.White()
const GREY    = Color4.create(0.65, 0.65, 0.65, 1)

// ── Bottom pills ──────────────────────────────────────────────
const PILL_W          = 580
const PILL_H_LG       = 72
const PILL_H_SM       = 92
const PILL_PAD_X      = 36   // horizontal padding inside toast + persistent pills
const PERSIST_BOTTOM  = 90
const PILL_STEP       = PILL_H_SM + 12   // vertical stride between stacked pills

// ── Toast ─────────────────────────────────────────────────────
const TOAST_FONT_LG   = 24
const TOAST_FONT_SM   = 18

// ── Daily Limit pill ──────────────────────────────────────────
const DAILY_FONT          = 18
const DAILY_DISMISS_SIZE  = 44   // dismiss button width & height (also used as ghost spacer)
const DAILY_DISMISS_FONT  = 22

// ── Persistent pill ───────────────────────────────────────────
const PERSIST_FONT    = 18

// ── Top banner ────────────────────────────────────────────────
const BANNER_W            = 820   // wide enough for idle text + countdown + dismiss button
const BANNER_TOP          = 28

const BANNER_H_SINGLE     = 52   // one line of text
const BANNER_H_COUNTDOWN  = 80   // main line + countdown subtitle

const BANNER_DISMISS_SIZE = 36   // close button width & height
const BANNER_DISMISS_FONT = 15

const BANNER_FONT_BLOOM     = 20
const BANNER_FONT_COUNTDOWN = 19
const BANNER_FONT_IDLE      = 16
const BANNER_LINE1_H        = 32   // height of the main text row
const BANNER_SUBTEXT_FONT   = 13
const BANNER_SUBTEXT_H      = 22   // height of the countdown subtitle row

// Banner text colours per state (background is always DARK)
const TEXT_IDLE      = Color4.create(0.72, 0.80, 0.72, 1.00)  // muted sage
const TEXT_COUNTDOWN = Color4.create(0.95, 1.00, 0.88, 1.00)  // bright off-white
const TEXT_BLOOM     = Color4.create(1.00, 0.92, 0.35, 1.00)  // golden yellow
const TEXT_SUBTEXT   = Color4.create(0.65, 0.80, 0.65, 0.85)

// ── Right-side vertical health bar ────────────────────────────
const SIDE_W          = 48    // bar track width (px)
const SIDE_H          = 420   // bar track height (px) — 1.5× original 280
const SIDE_LABEL_H    = 26    // % label above the bar
const SIDE_LABEL_FONT = 13
const SIDE_GAP        = 6     // gap between label and bar
const SIDE_FILL_MIN   = 2     // minimum fill height in px when health > 0
const PLAYER_COUNT_H    = 22
const PLAYER_COUNT_FONT = 11
const GARDEN_TITLE_H    = 22
const GARDEN_TITLE_FONT = 10
const SIDE_PILL_PAD_Y   = 5   // vertical padding inside the dark pill
const SIDE_PILL_GAP     = 6   // gap between pill and bar
const SIDE_PILL_H       = PLAYER_COUNT_H + 4 + GARDEN_TITLE_H + 4 + SIDE_LABEL_H + SIDE_PILL_PAD_Y * 2

// Watering can image — sits above the dark pill
const WATERING_CAN_SRC  = 'assets/scene/Images/WateringCanRender.png'
const CAN_IMG_SIZE       = 72    // square display size
const CAN_IMG_GAP        = 8     // gap between image and dark pill
const CAN_BADGE_H     = 22
const CAN_BADGE_MIN_W = 34
const CAN_BADGE_PAD_X = 6
const CAN_BADGE_FONT  = 12

const SIDE_COL_W    = SIDE_W
const SIDE_TOTAL_H  = SIDE_PILL_H + SIDE_PILL_GAP + SIDE_H
const SIDE_RIGHT_PAD  = 44    // distance from right edge

// Tick marks (match the 3D boards: 25%, 50%, 80%)
const TICK_W           = SIDE_W + 10   // slightly wider than bar (overhangs 5px each side)
const TICK_OFFSET_X    = -5            // nudge left to centre the overhang
const TICK_H_NORMAL    = 2
const TICK_H_THRESHOLD = 3

// Bar fill colours (same thresholds as 3D boards)
const BAR_DARK   = Color4.create(0.08, 0.08, 0.09, 0.92)   // track background
const BAR_RED    = Color4.create(0.85, 0.18, 0.18, 1)
const BAR_ORANGE = Color4.create(1.00, 0.50, 0.05, 1)
const BAR_GREEN  = Color4.create(0.20, 0.88, 0.35, 1)
const TICK_COLOR = Color4.create(0.70, 0.70, 0.70, 1)
const TICK_GOLD  = Color4.create(1.00, 0.84, 0.10, 1)      // threshold marker

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

function sideFillColor(): Color4 {
  if (bannerHealth >= 0.80) return BAR_GREEN
  if (bannerHealth >= 0.50) return BAR_ORANGE
  return BAR_RED
}

function bannerLine1(): string {
  if (bannerState === 'bloom')     return bannerBloomLabel || 'The Garden is in Full Bloom!'
  if (bannerState === 'countdown') return `Keep garden health above 80% for ${bannerCountdown} to wake the big bloom`
  return 'Keep garden health above 80% to wake the big bloom'
}
function bannerHealthLine(): string | null {
  if (bannerState === 'bloom') return null
  return `Garden Health: ${Math.round(bannerHealth * 100)}%`
}
function bannerFontSize(): number {
  return bannerState === 'bloom' ? BANNER_FONT_BLOOM : bannerState === 'countdown' ? BANNER_FONT_COUNTDOWN : BANNER_FONT_IDLE
}
function bannerTextColor(): Color4 {
  if (bannerState === 'bloom')     return TEXT_BLOOM
  if (bannerState === 'countdown') return TEXT_COUNTDOWN
  return TEXT_IDLE
}
function showPlusOneWater(): void {
  showToast('+1 water', 900, false)
}
// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------

// ── Virtual canvas (ported from Clean The Club) ─────────────────────────────
// SDK 7.26 (upgraded 2026-09-17 to the Clean The Club pin — scene UI did not
// render at all on the mobile app under 7.21): the renderer scales by
// min(canvasW / virtualW, canvasH / virtualH) with NO pixel-ratio term, and the
// canvas is reported in physical px. So px values map to screenH / virtualH:
// 2160 keeps the garden's 1080-tuned desktop look on KJ's retina iMac (dpr 2);
// 1440 is CTC's tuned mobile value ("720 × dpr", 720 was 2–3× too big).
// Width is flexed to the real screen aspect so a fit-to-height letterbox
// never left-anchors "centred" content. screenInset is 'none' (as in Clean The
// Club): 'interactable' centres the HUD inside the joystick-free rectangle, i.e.
// well RIGHT of the physical centre on phones — we inset ourselves instead, with
// a horizontally balanced device-inset container (see the root below).
// Calibrate with the top-left canvas line (the phone has a console under >_).
const DESKTOP_VIRTUAL_H = 2160    // TUNING — lower = bigger HUD on desktop
const MOBILE_VIRTUAL_H  = 1080    // TUNING — lower = bigger HUD on phones (1440 read too small)
let currentVirtualH = DESKTOP_VIRTUAL_H
let currentVirtualW = Math.round(DESKTOP_VIRTUAL_H * 16 / 9)
let loggedCanvasCalib = false

export function getCanvasCalibration(): string {
  const c  = readCanvasInfo()
  const sa = getSafeArea()
  return `${isMobile() ? 'mobile' : 'desktop'} canvas ${c ? `${c.width}x${c.height} dpr=${c.devicePixelRatio}` : '?'} -> virtual ${currentVirtualW}x${currentVirtualH} | safe ${sa.known ? 'live' : 'fallback'} t${pct(sa.top)} b${pct(sa.bottom)} l${pct(sa.left)} r${pct(sa.right)}`
}

/** Engine system (NOT called from the render — re-entering setUiRenderer mid-render
 *  can unmount the whole tree): re-fits the virtual canvas when platform / aspect /
 *  dpr change. isMobile() flips from false once the platform round-trip lands. */
let fitAccum = 0
function fitVirtualCanvasSystem(dt: number): void {
  fitAccum += dt
  if (fitAccum < 0.25) return
  fitAccum = 0
  const c = readCanvasInfo()
  if (!c) return
  const vh     = isMobile() ? MOBILE_VIRTUAL_H : DESKTOP_VIRTUAL_H
  const aspect = c.width / c.height
  const vw     = Math.round(vh * Math.max(1, Math.min(10 / 3, aspect)))
  if (!loggedCanvasCalib) { loggedCanvasCalib = true; console.log(`[UI] ${getCanvasCalibration()}`) }
  if (vh !== currentVirtualH || Math.abs(vw - currentVirtualW) >= 8) {
    currentVirtualH = vh
    currentVirtualW = vw
    ReactEcsRenderer.setUiRenderer(uiComponent, { virtualWidth: currentVirtualW, virtualHeight: currentVirtualH, screenInset: 'none' })
    console.log(`[UI] virtual canvas -> ${currentVirtualW}x${currentVirtualH}`)
  }
}

export function setupUi(): void {
  ReactEcsRenderer.setUiRenderer(uiComponent, { virtualWidth: currentVirtualW, virtualHeight: currentVirtualH, screenInset: 'none' })
  engine.addSystem(fitVirtualCanvasSystem)
}

// ---------------------------------------------------------------
// Render
// ---------------------------------------------------------------

// Mobile text scale — set each render; fonts go through fs() so desktop is untouched.
let uiFont = 1
const fs = (n: number): number => Math.round(n * uiFont)

function uiComponent() {
  const sa = getSafeArea()
  const mobile = isMobile()
  const M  = mobile ? 1.3 : 1        // touch targets + small screens want larger chrome
  uiFont   = mobile ? 1.5 : 1        // …and larger text (16 px read as ~11 px on the phone)
  // Health column: wider + bigger labels on mobile, but a SHORTER bar parked high —
  // the client draws its F / + / jump cluster over the bottom-right by design
  // (interactableArea only reserves ~6% there), so the bar must end by ~58%.
  const SS          = mobile ? 1.5 : 1
  const sideW       = Math.round(SIDE_W * SS)
  const sideH       = mobile ? 300 : SIDE_H
  const sidePillPadY = Math.round(SIDE_PILL_PAD_Y * SS)
  const sideLabelH  = Math.round(SIDE_LABEL_H * SS)
  const gardenTitleH = Math.round(GARDEN_TITLE_H * SS)
  const sidePillH   = Math.round(SIDE_PILL_H * SS)
  const sideTotalH  = sidePillH + SIDE_PILL_GAP + sideH
  const tickW       = sideW + 10
  const bannerDismiss = Math.round(BANNER_DISMISS_SIZE * M)
  const dailyDismiss  = Math.round(DAILY_DISMISS_SIZE * M)
  const safeBottomPx = Math.round(sa.bottom * currentVirtualH)   // explorer chrome along the bottom edge
  const dailyBottom = PERSIST_BOTTOM + (persistVisible ? PILL_STEP : 0)
  const toastBottom = dailyBottom    + (dailyLimitVisible ? PILL_STEP : 0)
  const toastH      = toastLarge ? PILL_H_LG : PILL_H_SM

  const isCountdown  = bannerState === 'countdown'
  const isBloom      = bannerState === 'bloom'
  const bannerH      = BANNER_H_SINGLE

  // Side bar fill — grows from bottom, minimum SIDE_FILL_MIN px when health > 0
  const fillH       = bannerHealth > 0 ? Math.max(SIDE_FILL_MIN, Math.round(bannerHealth * sideH)) : 0
  const fillTop     = sideH - fillH   // top offset within track (bottom-anchored)

  // Tick positions (top offset from bar track top)
  const tick25Top  = Math.round(sideH * 0.75) - TICK_H_NORMAL
  const tick50Top  = Math.round(sideH * 0.50) - TICK_H_NORMAL
  const tick80Top  = Math.round(sideH * 0.20) - TICK_H_THRESHOLD

  // Percent label (0–100)
  const pctLabel = `${Math.round(bannerHealth * 100)}%`

  // Root MUST be full-screen: the mobile (Godot) client clips children to the
  // parent's box, so a size-less root hides every absolute child (2026-09-17 —
  // no scene UI at all on the phone, live or preview). Desktop never clipped.
  const ins = getScreenInsets()
  const h   = Math.max(ins.left, ins.right)   // balanced → centre stays the physical centre
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%' }}>
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: pct(ins.top), left: pct(h), right: pct(h), bottom: pct(ins.bottom) } }}>

      {/* ── Test Panel — MOUNTED for v2 dev; comment out before production deploys ── */}
      <TestPanelUi />
      {/* Dev calibration line (remove with the test panel): fixed top-left so it shows
          whatever the phone's canvas/scale turns out to be. */}
      <Label
        value={getCanvasCalibration()}
        fontSize={11}
        color={{ r: 1, g: 1, b: 1, a: 0.85 }}
        uiTransform={{ positionType: 'absolute', position: { left: 6, top: 4 }, width: 900, height: 18 }}
      />

      {/* ═══════════════════════════════════════════════════════════
          TOP BANNER — always dark, compact, player-dismissible
      ══════════════════════════════════════════════════════════════ */}
      <UiEntity
        uiTransform={{
          display:        bannerVisible ? 'flex' : 'none',
          positionType:   'absolute',
          position:       { top: pct(sa.top), left: 0 },
          width:          '100%',
          flexDirection:  'row',
          justifyContent: 'center',
        }}
      >
      <UiEntity
        uiTransform={{
          margin:         { top: Math.round((BANNER_TOP + bannerOffsetY) * M) },
          width:          Math.round(BANNER_W * M),
          height:         Math.round(bannerH * M),
          flexDirection:  'row',
          alignItems:     'center',
        }}
        uiBackground={{ color: DARK }}
      >
        {/* Ghost spacer — mirrors dismiss button so text stays centred */}
        <UiEntity uiTransform={{ width: bannerDismiss, height: bannerDismiss, flexShrink: 0 }} />

        {/* Centre content column */}
        <UiEntity
          uiTransform={{
            flexGrow:       1,
            height:         '100%',
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
          }}
        >
          <Label
            value={bannerLine1()}
            fontSize={fs(bannerFontSize())}
            color={bannerTextColor()}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: Math.round(BANNER_LINE1_H * M) }}
          />
        </UiEntity>

        {/* Dismiss button */}
        <UiEntity
          uiTransform={{ width: bannerDismiss, height: bannerDismiss, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          onMouseDown={hideBanner}
        >
          <Label
            value="✕"
            fontSize={fs(BANNER_DISMISS_FONT)}
            color={TEXT_IDLE}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: '100%' }}
          />
        </UiEntity>
      </UiEntity>

      </UiEntity>

      {/* ═══════════════════════════════════════════════════════════
          RIGHT SIDE — vertical health bar (mimics 3D boards)
      ══════════════════════════════════════════════════════════════ */}
      <UiEntity
        uiTransform={{
          positionType:   'absolute',
          position:       { top: pct(mobile ? Math.max(sa.top, 0.16) : Math.max(sa.top, 0.5 - sideTotalH / currentVirtualH / 2)), right: pct(sa.right + SIDE_RIGHT_PAD / 1920) },
          width:          sideW,
          height:         sideTotalH,
          flexDirection:  'column',
          alignItems:     'center',
        }}
      >
        {/* Dark pill — player count + title + % */}
        <UiEntity
          uiTransform={{
            width:          sideW,
            height:         sidePillH,
            flexShrink:     0,
            flexDirection:  'column',
            alignItems:     'center',
            justifyContent: 'center',
            padding:        { top: sidePillPadY, bottom: sidePillPadY },
          }}
          uiBackground={{ color: DARK }}
        >
          <Label
            value="Garden Health"
            fontSize={fs(GARDEN_TITLE_FONT)}
            color={TEXT_IDLE}
            textAlign="middle-center"
            uiTransform={{ width: sideW, height: gardenTitleH }}
          />
          <UiEntity uiTransform={{ width: sideW, height: 4, flexShrink: 0 }} />
          <Label
            value={pctLabel}
            fontSize={fs(SIDE_LABEL_FONT)}
            color={GREY}
            textAlign="middle-center"
            uiTransform={{ width: sideW, height: sideLabelH }}
          />
        </UiEntity>

        {/* Spacer between pill and bar */}
        <UiEntity uiTransform={{ width: sideW, height: SIDE_PILL_GAP, flexShrink: 0 }} />

        {/* Bar track */}
        <UiEntity
          uiTransform={{
            width:        sideW,
            height:       sideH,
            flexShrink:   0,
            positionType: 'relative',
          }}
          uiBackground={{ color: BAR_DARK }}
        >
          {/* Fill — bottom-anchored */}
          {fillH > 0 && (
            <UiEntity
              uiTransform={{
                positionType: 'absolute',
                position:     { top: fillTop, left: 0 },
                width:        sideW,
                height:       fillH,
              }}
              uiBackground={{ color: sideFillColor() }}
            />
          )}

          {/* Tick 25% */}
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position:     { top: tick25Top, left: TICK_OFFSET_X },
              width:        tickW,
              height:       TICK_H_NORMAL,
            }}
            uiBackground={{ color: TICK_COLOR }}
          />

          {/* Tick 50% */}
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position:     { top: tick50Top, left: TICK_OFFSET_X },
              width:        tickW,
              height:       TICK_H_NORMAL,
            }}
            uiBackground={{ color: TICK_COLOR }}
          />

          {/* Tick 80% — gold threshold marker */}
          <UiEntity
            uiTransform={{
              positionType: 'absolute',
              position:     { top: tick80Top, left: TICK_OFFSET_X },
              width:        tickW,
              height:       TICK_H_THRESHOLD,
            }}
            uiBackground={{ color: TICK_GOLD }}
          />
        </UiEntity>
      </UiEntity>

      {/* ── Toast ─────────────────────────────────────────────── */}
      <UiEntity
        uiTransform={{
          display:        toastVisible ? 'flex' : 'none',
          positionType:   'absolute',
          position:       { bottom: safeBottomPx + Math.round(toastBottom * M), left: '50%' },
          margin:         { left: -Math.round(PILL_W * M / 2) },
          width:          Math.round(PILL_W * M),
          height:         Math.round(toastH * M),
          alignItems:     'center',
          justifyContent: 'center',
          padding:        { left: PILL_PAD_X, right: PILL_PAD_X },
        }}
        uiBackground={{ color: DARK }}
      >
        <Label
          value={toastText}
          fontSize={fs(toastLarge ? TOAST_FONT_LG : TOAST_FONT_SM)}
          color={WHITE}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: '100%' }}
        />
      </UiEntity>

      {/* ── Daily Limit (dismissible) ──────────────────────────── */}
      <UiEntity
        uiTransform={{
          display:        dailyLimitVisible ? 'flex' : 'none',
          positionType:   'absolute',
          position:       { bottom: safeBottomPx + Math.round(dailyBottom * M), left: '50%' },
          margin:         { left: -Math.round(PILL_W * M / 2) },
          width:          Math.round(PILL_W * M),
          height:         Math.round(PILL_H_SM * M),
          flexDirection:  'row',
          alignItems:     'center',
        }}
        uiBackground={{ color: DARK }}
      >
        {/* Ghost spacer — mirrors the dismiss button so the label area is symmetric */}
        <UiEntity uiTransform={{ width: dailyDismiss, height: dailyDismiss, flexShrink: 0 }} />
        <Label
          value={dailyLimitText}
          fontSize={fs(DAILY_FONT)}
          color={WHITE}
          textAlign="middle-center"
          uiTransform={{ flexGrow: 1, height: '100%' }}
        />
        <UiEntity
          uiTransform={{ width: dailyDismiss, height: dailyDismiss, alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
          onMouseDown={hideDailyLimit}
        >
          <Label
            value="✕"
            fontSize={fs(DAILY_DISMISS_FONT)}
            color={WHITE}
            textAlign="middle-center"
            uiTransform={{ width: '100%', height: '100%' }}
          />
        </UiEntity>
      </UiEntity>

      {/* ── Persistent ────────────────────────────────────────── */}
      <UiEntity
        uiTransform={{
          display:        persistVisible ? 'flex' : 'none',
          positionType:   'absolute',
          position:       { bottom: safeBottomPx + Math.round(PERSIST_BOTTOM * M), left: '50%' },
          margin:         { left: -Math.round(PILL_W * M / 2) },
          width:          Math.round(PILL_W * M),
          height:         Math.round(PILL_H_SM * M),
          alignItems:     'center',
          justifyContent: 'center',
          padding:        { left: PILL_PAD_X, right: PILL_PAD_X },
        }}
        uiBackground={{ color: DARK }}
      >
        <Label
          value={persistText}
          fontSize={fs(PERSIST_FONT)}
          color={WHITE}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: '100%' }}
        />
      </UiEntity>

    </UiEntity>
    </UiEntity>
  )
}
