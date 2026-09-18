// =============================================================
// Bloom Garden — live UI safe area (ported from Clean The Club)
//
// The explorer draws its own HUD (chat, minimap, joystick, interaction
// buttons…) OVER scene UI and reports the still-usable rectangle in
// UiCanvasInformation.interactableArea. That rectangle is LIVE (chat open /
// closed) and differs per platform, so HUD anchors read it every render
// instead of guessing corners.
//
// COORDINATES: interactableArea is in real canvas pixels (UiCanvasInformation
// width/height), NOT our virtual canvas — so insets are returned as FRACTIONS
// (0..1) and callers anchor with percentage positions.
// =============================================================

import { engine, UiCanvasInformation } from '@dcl/sdk/ecs'
import { isMobile } from '@dcl/sdk/platform'

type Insets = { top: number; left: number; right: number; bottom: number }
export type CanvasInfo = { width: number; height: number; devicePixelRatio: number; interactableArea?: Insets; screenInsetArea?: Insets }

/** DEVICE screen insets (notch, status bar, home indicator) as fractions of the
 *  canvas — the field the SDK's own ScreenInsetArea positions from. Exposed so
 *  the UI root can build a horizontally BALANCED container: with screenInset
 *  'interactable' the client centres inside the joystick-free rectangle, which
 *  put "centred" UI well right of the physical centre on the phone (2026-09-17). */
export function getScreenInsets(): { top: number; left: number; right: number; bottom: number } {
  const info = readCanvasInfo()
  const a = info?.screenInsetArea
  if (!info || !a) return { top: 0, left: 0, right: 0, bottom: 0 }
  return {
    top:    Math.max(0, a.top    / info.height),
    left:   Math.max(0, a.left   / info.width),
    right:  Math.max(0, a.right  / info.width),
    bottom: Math.max(0, a.bottom / info.height),
  }
}

// 100 ms memo — read from several UI sites per render; the canvas only changes
// on resize / chat toggle.
let cachedInfo: CanvasInfo | null = null
let cachedInfoAtMs = 0
let loggedSource = ''

export function readCanvasInfo(): CanvasInfo | null {
  const now = Date.now()
  if (now - cachedInfoAtMs < 100) return cachedInfo
  cachedInfoAtMs = now
  cachedInfo = readCanvasInfoFresh()
  return cachedInfo
}

// Classically on engine.RootEntity, but explorer builds have shipped with it
// elsewhere — fall back to a scan and log which path worked once.
function readCanvasInfoFresh(): CanvasInfo | null {
  const root = UiCanvasInformation.getOrNull(engine.RootEntity)
  if (root && root.width > 0 && root.height > 0) {
    if (loggedSource !== 'root') { loggedSource = 'root'; console.log('[UI] canvas info via RootEntity') }
    return root as CanvasInfo
  }
  for (const [, info] of engine.getEntitiesWith(UiCanvasInformation)) {
    if (info.width > 0 && info.height > 0) {
      if (loggedSource !== 'scan') { loggedSource = 'scan'; console.log('[UI] canvas info via entity scan (not RootEntity)') }
      return info as CanvasInfo
    }
  }
  if (loggedSource !== 'none') { loggedSource = 'none'; console.log('[UI] canvas info UNAVAILABLE — safe-area fallback active') }
  return null
}

export type SafeArea = {
  top: number; left: number; right: number; bottom: number   // fractions of the screen
  known: boolean                                             // true = real interactableArea
}

// Fallbacks when interactableArea isn't populated (early frames, odd clients).
// Mobile: joystick bottom-left, interaction cluster bottom-right, top bar.
const FALLBACK_DESKTOP: SafeArea = { top: 0.06, left: 0.02, right: 0.02, bottom: 0.06, known: false }
const FALLBACK_MOBILE:  SafeArea = { top: 0.10, left: 0.04, right: 0.04, bottom: 0.20, known: false }

let cachedArea: SafeArea = FALLBACK_DESKTOP
let cachedAreaAtMs = 0

export function getSafeArea(): SafeArea {
  const now = Date.now()
  if (now - cachedAreaAtMs < 100) return cachedArea
  cachedAreaAtMs = now
  cachedArea = computeSafeArea()
  return cachedArea
}

function computeSafeArea(): SafeArea {
  const info = readCanvasInfo()
  if (!info || !info.interactableArea) return isMobile() ? FALLBACK_MOBILE : FALLBACK_DESKTOP
  const a = info.interactableArea
  return {
    top:    Math.max(0, a.top    / info.height),
    left:   Math.max(0, a.left   / info.width),
    right:  Math.max(0, a.right  / info.width),
    bottom: Math.max(0, a.bottom / info.height),
    known:  true,
  }
}

/** `${n}%` from a 0..1 fraction, for uiTransform positions. */
export const pct = (fraction: number): `${number}%` => `${Math.round(fraction * 1000) / 10}%`
