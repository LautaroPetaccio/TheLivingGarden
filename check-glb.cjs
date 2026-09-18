#!/usr/bin/env node
// Checks the GLBs the SCENE SERVER loads for properties that crash the Babylon.js
// NullEngine (headless server). Run before deploying:
//   node check-glb.cjs
//
// Scope (2026-09-18): only GLBs the server instantiates — everything referenced by
// assets/scene/main.composite plus any .glb path literal under src/server. Client-only
// models (the 78 flower species, balloons, seedlings…) never reach the server.
//
// Severity (2026-09-18, measured on the stock hammurabi-server 1.7.2): its render loop is
// wrapped in try/catch, so render-pass problems (BLEND, VEC4 vertex colour) only skip a
// frame — a BLEND material in the composite ran 60 s with 0 errors. Those are WARNINGS now.
// Load-time problems (transmission/volume render targets) are untested → still BLOCK.
//
// BLOCK (fails the deploy):
//   KHR_materials_transmission  — requires WebGL render target (no GPU in server)
//   KHR_materials_volume        — same reason
//   specularColorFactor > 1.0   — produces NaN in material.freeze()
// WARN (crashed the OLD pinned server; the stock server skips the frame):
//   COLOR_N accessor type VEC4  — hasVertexAlpha=true → transparent sorted render pass
//                                  Fix: run patch-glbs.cjs after each Blender export
//   alphaMode BLEND             — transparent sorted render pass
//                                  Fix: change to MASK (alphaCutoff=0.5)
//
// Safe for alpha:
//   alphaMode MASK  — leaf/foliage cutout ✅ (uses clip, stays in opaque pass)

const fs   = require('fs')
const path = require('path')

const CRASH_EXTENSIONS = ['KHR_materials_transmission', 'KHR_materials_volume']

function checkGlb(filePath) {
  const data   = fs.readFileSync(filePath)
  const magic  = data.readUInt32LE(0)
  if (magic !== 0x46546C67) return null  // not a GLB

  let offset = 12
  while (offset < data.length) {
    const chunkLen  = data.readUInt32LE(offset)
    const chunkType = data.readUInt32LE(offset + 4)
    if (chunkType === 0x4E4F534A) {  // JSON chunk
      const json = JSON.parse(data.slice(offset + 8, offset + 8 + chunkLen).toString('utf8'))
      const issues = []   // { msg, block } — block=true fails the deploy

      // ── Material checks ─────────────────────────────────────────
      for (const [i, mat] of (json.materials || []).entries()) {
        const exts = mat.extensions || {}
        for (const ext of CRASH_EXTENSIONS) {
          if (exts[ext]) issues.push({ block: true, msg: `mat[${i}] "${mat.name}": uses ${ext} (CRASH at load)` })
        }
        const spec = exts.KHR_materials_specular || {}
        const cf   = spec.specularColorFactor || []
        if (cf.some(v => v > 1.0)) {
          issues.push({ block: true, msg: `mat[${i}] "${mat.name}": specularColorFactor [${cf.join(', ')}] > 1.0 (RISKY — NaN in freeze)` })
        }
        // alphaMode BLEND puts the mesh in _renderTransparentSorted, where NullEngine's
        // missing _effect throws — the stock server catches it per frame. MASK avoids it.
        if (mat.alphaMode === 'BLEND') {
          issues.push({ block: false, msg: `mat[${i}] "${mat.name}": alphaMode BLEND → transparent render pass (stock server skips the frame; MASK avoids it)` })
        }
      }

      // ── VEC4 COLOR_N check ──────────────────────────────────────
      // Babylon.js sets hasVertexAlpha=true for *any* VEC4 COLOR_N accessor —
      // not just COLOR_0. Secondary colour sets (COLOR_1, COLOR_2 …) exported
      // by Blender as RGBA hit the same transparent render pass.
      // Fix: run patch-glbs.cjs — it strips the alpha byte from all COLOR_N VEC4
      // accessors, converting VEC4 → VEC3.
      for (const [mi, mesh] of (json.meshes || []).entries()) {
        for (const [pi, prim] of (mesh.primitives || []).entries()) {
          for (const [attr, cidx] of Object.entries(prim.attributes || {})) {
            if (!/^COLOR_\d+$/.test(attr)) continue
            const acc = (json.accessors || [])[cidx]
            if (acc && acc.type === 'VEC4') {
              issues.push({ block: false, msg:
                `mesh[${mi}] "${mesh.name}" prim[${pi}]: ${attr} is VEC4 (RGBA) — ` +
                `hasVertexAlpha → transparent render pass (patch-glbs.cjs converts it)` })
            }
          }
        }
      }

      return issues
    }
    offset += 8 + ((chunkLen + 3) & ~3)
  }
  return null
}

const GLB_PATH = /assets\/[^"'`\\]*?\.glb/g

/** GLBs the scene server loads: the composite's models + .glb literals in server code. */
function serverGlbs(root) {
  const found = new Set()
  const composite = path.join(root, 'assets/scene/main.composite')
  if (fs.existsSync(composite)) for (const m of fs.readFileSync(composite, 'utf8').match(GLB_PATH) || []) found.add(m)
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(e.name)) for (const m of fs.readFileSync(full, 'utf8').match(GLB_PATH) || []) found.add(m)
    }
  }
  const serverSrc = path.join(root, 'src/server')
  if (fs.existsSync(serverSrc)) walk(serverSrc)
  return [...found].sort().map(rel => path.join(root, rel))
}

const root  = __dirname
const glbs  = serverGlbs(root)
let   clean = true

console.log(`Checking ${glbs.length} server-loaded GLB file(s)...\n`)

for (const glb of glbs) {
  const rel    = path.relative(root, glb)
  if (!fs.existsSync(glb)) { clean = false; console.log(`  ❌  ${rel}\n       → referenced but missing on disk`); continue }
  const issues = checkGlb(glb)
  if (!issues) continue
  const blocking = issues.some(i => i.block)
  if (blocking) clean = false
  console.log(`  ${issues.length === 0 ? '✅' : blocking ? '❌' : '⚠️ '}  ${rel}`)
  for (const issue of issues) console.log(`       → ${issue.block ? '' : '(warning) '}${issue.msg}`)
}

console.log()
if (clean) {
  console.log('All server-loaded GLBs are safe. Safe to deploy.')
} else {
  console.log('Fix the issues above before deploying — they will crash the server.')
  process.exit(1)
}
