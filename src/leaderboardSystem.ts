// =============================================================
// The Living Garden — Leaderboard System
//
// Two boards: south wall = THIS WEEK (top-10, resets at a visible time),
// north wall = ALL TIME (top-10 lifetime, never resets) — GDD §4.3 hook 2.
// Names carry milestone flair (GDD §5). All layout, style, and position
// config lives in the block below — no Creator Hub entities required.
// =============================================================

import {
  engine,
  Entity,
  Transform,
  TextShape,
  TextAlignMode,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
} from '@dcl/sdk/ecs'
import { Quaternion, Color4 } from '@dcl/sdk/math'
import { flairIcon } from './shared/config'

// ===============================================================
// ██████╗  ██████╗  █████╗ ██████╗ ██████╗     ██████╗ ██████╗ ███╗   ██╗███████╗██╗ ██████╗
// ██╔══██╗██╔═══██╗██╔══██╗██╔══██╗██╔══██╗   ██╔════╝██╔═══██╗████╗  ██║██╔════╝██║██╔════╝
// ██████╔╝██║   ██║███████║██████╔╝██║  ██║   ██║     ██║   ██║██╔██╗ ██║█████╗  ██║██║  ███╗
// ██╔══██╗██║   ██║██╔══██║██╔══██╗██║  ██║   ██║     ██║   ██║██║╚██╗██║██╔══╝  ██║██║   ██║
// ██████╔╝╚██████╔╝██║  ██║██║  ██║██████╔╝   ╚██████╗╚██████╔╝██║ ╚████║██║     ██║╚██████╔╝
// ╚═════╝  ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝     ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝ ╚═════╝
//
//  Edit anything in this block — no other files need touching.
// ===============================================================

// ── Board world positions ─────────────────────────────────────
// rotation: euler degrees  { x:0, y:0, z:0 } = faces +Z
//                          { x:0, y:180, z:0 } = faces -Z
const LB_WORLD_Y = 2.41    // raise / lower all boards together

const LB_BOARDS = [
  // Board 1 — south face (faces into the scene): this week's board
  { position: { x: 12.73, y: LB_WORLD_Y, z:  0.4 }, rotation: { x: 0, y: 180, z: 0 }, kind: 'weekly' as const },
  // Board 2 — north face: all-time board
  { position: { x: 12.73, y: LB_WORLD_Y, z: 47.6 }, rotation: { x: 0, y: 0,   z: 0 }, kind: 'allTime' as const },
]

// ── Titles ───────────────────────────────────────────────────
const LB_TITLE_GAP      = 0.30   // extra gap above the header row for the title line
const LB_FONT_TITLE     = 1.0
const LB_TITLE_WEEKLY   = 'THIS WEEK'
const LB_TITLE_ALL_TIME = 'ALL TIME'
const LB_COUNTDOWN_TICK_MS = 30_000

// ── Rows ─────────────────────────────────────────────────────
const LB_ENTRIES    = 10     // number of player rows per board
const LB_START_Y    = 0.30   // local Y of the first entry row
const LB_STEP_Y     = 0.175   // vertical gap between rows (decrease = tighter)
const LB_HEADER_GAP = 0.28   // extra gap above row 0 for the header

// ── Columns ──────────────────────────────────────────────────
const LB_NAME_X  = -1.25    // local X of the name column  (negative = left)
const LB_SCORE_X =  1    // local X of the score column (positive = right)
const LB_DEPTH   =  0.08    // local Z lift off the board face — increase if text clips into mesh

// ── Typography ───────────────────────────────────────────────
const LB_FONT_HEADER = 1.2   // header row font size
const LB_FONT_ENTRY  = 1.2   // entry row font size

// ── Column header labels ──────────────────────────────────────
const LB_HEADER_NAME  = 'NAME'
const LB_HEADER_SCORE = 'WATERS'

// ── Colours  (r/g/b/a each 0–1) ──────────────────────────────
const LB_COLOR_HEADER = { r: 1,   g: 0.84, b: 0.1, a: 1 }  // gold
const LB_COLOR_NAME   = { r: 1,   g: 1,    b: 1,   a: 1 }  // white
const LB_COLOR_SCORE  = { r: 0.6, g: 1,    b: 0.6, a: 1 }  // soft green

// ── Mock data ─────────────────────────────────────────────────
// Shown immediately on load until the server sends real data.
// Replace or reorder freely — only LB_ENTRIES rows are displayed.
export interface BoardEntry { displayName: string; count: number; tier?: number }
export interface BoardData  { weekly: BoardEntry[]; allTime: BoardEntry[]; weeklyResetAt: number }

const LB_MOCK_DATA: BoardEntry[] = [
  { displayName: 'GreenThumb99',  count: 42 },
  { displayName: 'FloraFairy',    count: 38 },
  { displayName: 'PlantDaddy',    count: 35 },
  { displayName: 'WaterWitch',    count: 31 },
  { displayName: 'BotanicBob',    count: 28 },
  { displayName: 'SeedQueen',     count: 24 },
  { displayName: 'LeafLover',     count: 19 },
  { displayName: 'BudWhisperer',  count: 15 },
  { displayName: 'SproutKing',    count: 11 },
  { displayName: 'DaisyChain',    count:  7 },
]

// =============================================================
//                  end of config
// =============================================================

// Each entry = two label entities [nameLabel, scoreLabel],
// interleaved per board: [name0, score0, name1, score1, …] × boards
const leaderboardLabels: Entity[] = []
// One flair icon plane per row, left of the rank (scale 0 = no flair). Same order as rows.
const flairIcons: Entity[] = []
const LB_FLAIR_X    = LB_NAME_X - 0.14
const LB_FLAIR_SIZE = 0.13

function setRowFlair(icon: Entity, tier: number): void {
  const f = flairIcon(tier)
  const k = f ? LB_FLAIR_SIZE : 0
  Transform.getMutable(icon).scale = { x: k, y: k, z: k }
  if (!f) return
  Material.setPbrMaterial(icon, {
    texture: Material.Texture.Common({ src: f.src }), alphaTexture: Material.Texture.Common({ src: f.src }),
    albedoColor: Color4.create(f.tint.r, f.tint.g, f.tint.b, 1), emissiveColor: f.tint, emissiveIntensity: 0.9,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false,
  })
}
const titleLabels: Entity[] = []          // one per board, same order as LB_BOARDS
let   weeklyResetAt = 0                   // epoch ms; 0 = unknown (mock)
let   countdownAccum = 0

/** Returns the name and score label entities for a given board and row. */
function getLabels(boardIdx: number, entryIdx: number): { name: Entity; score: Entity } {
  const base = boardIdx * (LB_ENTRIES * 2) + entryIdx * 2
  return { name: leaderboardLabels[base], score: leaderboardLabels[base + 1] }
}

function formatCountdown(ms: number): string {
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000), m = Math.floor((ms % 3_600_000) / 60_000)
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${Math.max(1, m)}m`
}

function titleFor(kind: 'weekly' | 'allTime'): string {
  if (kind === 'allTime') return LB_TITLE_ALL_TIME
  if (!weeklyResetAt) return LB_TITLE_WEEKLY
  const left = weeklyResetAt - Date.now()
  return left > 0 ? `${LB_TITLE_WEEKLY}  -  resets in ${formatCountdown(left)}` : `${LB_TITLE_WEEKLY}  -  resetting`
}

function refreshTitles(): void {
  for (let b = 0; b < LB_BOARDS.length; b++) {
    const t = titleLabels[b]
    if (t) TextShape.getMutable(t).text = titleFor(LB_BOARDS[b].kind)
  }
}

function countdownSystem(dt: number): void {
  countdownAccum += dt * 1_000
  if (countdownAccum < LB_COUNTDOWN_TICK_MS) return
  countdownAccum = 0
  refreshTitles()
}

export function setupLeaderboardBoards(): void {
  for (const boardDef of LB_BOARDS) {
    const quat = Quaternion.fromEulerDegrees(
      boardDef.rotation.x,
      boardDef.rotation.y,
      boardDef.rotation.z,
    )

    const board = engine.addEntity()
    Transform.create(board, { position: boardDef.position, rotation: quat })

    const headerY = LB_START_Y + LB_HEADER_GAP

    // Title line (board kind + weekly reset countdown)
    const title = engine.addEntity()
    Transform.create(title, { position: { x: LB_NAME_X, y: headerY + LB_TITLE_GAP, z: LB_DEPTH }, parent: board })
    TextShape.create(title, { text: titleFor(boardDef.kind), fontSize: LB_FONT_TITLE, textColor: LB_COLOR_HEADER, textAlign: TextAlignMode.TAM_MIDDLE_LEFT })
    titleLabels.push(title)

    // Header row
    const hName = engine.addEntity()
    Transform.create(hName, { position: { x: LB_NAME_X,  y: headerY, z: LB_DEPTH }, parent: board })
    TextShape.create(hName,  { text: LB_HEADER_NAME,  fontSize: LB_FONT_HEADER, textColor: LB_COLOR_HEADER, textAlign: TextAlignMode.TAM_MIDDLE_LEFT })

    const hScore = engine.addEntity()
    Transform.create(hScore, { position: { x: LB_SCORE_X, y: headerY, z: LB_DEPTH }, parent: board })
    TextShape.create(hScore, { text: LB_HEADER_SCORE, fontSize: LB_FONT_HEADER, textColor: LB_COLOR_HEADER })

    // Entry rows
    for (let i = 0; i < LB_ENTRIES; i++) {
      const y = LB_START_Y - i * LB_STEP_Y

      const nameLabel = engine.addEntity()
      Transform.create(nameLabel,  { position: { x: LB_NAME_X,  y, z: LB_DEPTH }, parent: board })
      TextShape.create(nameLabel,  { text: '', fontSize: LB_FONT_ENTRY, textColor: LB_COLOR_NAME, textAlign: TextAlignMode.TAM_MIDDLE_LEFT })

      const scoreLabel = engine.addEntity()
      Transform.create(scoreLabel, { position: { x: LB_SCORE_X, y, z: LB_DEPTH }, parent: board })
      TextShape.create(scoreLabel, { text: '', fontSize: LB_FONT_ENTRY, textColor: LB_COLOR_SCORE })

      leaderboardLabels.push(nameLabel, scoreLabel)

      const flair = engine.addEntity()
      Transform.create(flair, { position: { x: LB_FLAIR_X, y, z: LB_DEPTH }, scale: { x: 0, y: 0, z: 0 }, parent: board })
      MeshRenderer.setPlane(flair)
      flairIcons.push(flair)
    }
  }

  // Show mock data immediately so the board looks populated before
  // the server sends its first leaderboardUpdate message
  updateLeaderboardDisplay({ weekly: LB_MOCK_DATA, allTime: LB_MOCK_DATA, weeklyResetAt: 0 })
  engine.addSystem(countdownSystem)
}

export function updateLeaderboardDisplay(data: BoardData): void {
  weeklyResetAt = data.weeklyResetAt
  for (let b = 0; b < LB_BOARDS.length; b++) {
    const entries = LB_BOARDS[b].kind === 'weekly' ? data.weekly : data.allTime
    for (let i = 0; i < LB_ENTRIES; i++) {
      const entry          = entries[i]
      const { name, score } = getLabels(b, i)
      if (!name || !score) continue
      TextShape.getMutable(name).text  = entry ? `${i + 1}.  ${entry.displayName}` : ''
      const icon = flairIcons[b * LB_ENTRIES + i]
      if (icon) setRowFlair(icon, entry?.tier ?? 0)
      TextShape.getMutable(score).text = entry ? `${entry.count}` : ''
    }
  }
  refreshTitles()
}
