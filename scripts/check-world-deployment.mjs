// Reports what deploying this scene would do to its world, before anything is signed.
//
// Answers three questions the deploy itself will not ask you:
//   1. Does the world already hold scenes, and will this deploy replace them?
//   2. Will the world be publicly listed afterwards, and is that a change?
//   3. Is the deploying wallet actually allowed to deploy to this world?
//
// On listing: the places service creates the world row during the deploy itself
// (insertWorldIfNotExists), setting show_in_places from this scene's
// worldConfiguration.placesConfig.optOut. A world is listed only when that flag is
// true AND it has at least one place that is not disabled, and opting out disables
// its place. So a listing lookup alone cannot tell a missing world from an opted-out
// one; the single-world endpoint is the existence check, and optOut decides the rest.
//
// It deliberately does NOT predict whether a new place row is created. That depends on
// how many active places in the world overlap the deploying parcels, which no public
// endpoint exposes.
//
// Writes GitHub Actions outputs and a run summary when those env vars are present,
// and prints the same report locally. Exits non-zero only when the deploy could
// not succeed as configured.
//
// Usage: node scripts/check-world-deployment.mjs [--target-content <url>]

import { readFile, appendFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const DEFAULT_CONTENT = 'https://worlds-content-server.decentraland.org'
const PLACES_API      = 'https://places.decentraland.org/api'

function arg(name, fallback) {
  const i = process.argv.indexOf(name)
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const targetContent = (arg('--target-content', process.env.TARGET_CONTENT || DEFAULT_CONTENT)).replace(/\/+$/, '')
const deployer      = (process.env.DEPLOYER_ADDRESS || '').trim().toLowerCase()

/** GET returning parsed JSON, or null on 404. Throws on any other failure so a
 *  service that is down never reads as "the world does not exist". */
async function getJson(url) {
  const res = await fetch(url)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`)
  return res.json()
}

async function setOutput(key, value) {
  if (!process.env.GITHUB_OUTPUT) return
  await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`)
}

async function summary(markdown) {
  console.log(markdown)
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown + '\n')
}

const scene = JSON.parse(await readFile(resolve(root, 'scene.json'), 'utf8'))
const world = scene.worldConfiguration?.name
const title = scene.display?.title ?? '(untitled)'
const parcels = scene.scene?.parcels ?? []
const optsOut = !!scene.worldConfiguration?.placesConfig?.optOut

if (!world) {
  console.error('scene.json has no worldConfiguration.name — this workflow only deploys worlds.')
  process.exit(1)
}

const encoded = encodeURIComponent(world)

let scenesRes, permissions, registered, listed
try {
  ;[scenesRes, permissions, registered, listed] = await Promise.all([
    getJson(`${targetContent}/world/${encoded}/scenes`),
    getJson(`${targetContent}/world/${encoded}/permissions`),
    // Existence, unfiltered by listing eligibility.
    getJson(`${PLACES_API}/worlds/${encoded}`),
    // Listing eligibility: filtered on show_in_places and a non-disabled place.
    getJson(`${PLACES_API}/worlds?names=${encoded}`),
  ])
} catch (err) {
  // Never fall through to "the world looks empty" when a lookup failed — that is
  // exactly the reading that would make a destructive deploy look safe.
  console.error(`Could not read the world's current state: ${err instanceof Error ? err.message : err}`)
  console.error('Refusing to report a deploy plan from incomplete information.')
  process.exit(1)
}

const existing = scenesRes?.scenes ?? []
const replaced = existing.length
const isRegistered = registered !== null
const isListed = Number(listed?.total ?? 0) > 0
// show_in_places is written from optOut on every deploy, and a non-opted-out deploy
// leaves at least one enabled place behind, so this is decided here and not elsewhere.
const willBeListed = !optsOut
const listingChanges = willBeListed !== isListed

const owner = (permissions?.owner ?? '').toLowerCase()
const deployment = permissions?.permissions?.deployment
let permission = 'unknown'
if (deployer) {
  if (owner && owner === deployer) permission = 'owner'
  else if (deployment?.type === 'unrestricted') permission = 'unrestricted'
  else if ((deployment?.wallets ?? []).map(w => String(w).toLowerCase()).includes(deployer)) permission = 'allow-listed'
  else permission = 'denied'
}

await setOutput('world', world)
await setOutput('world_registered', String(isRegistered))
await setOutput('listed_now', String(isListed))
await setOutput('listed_after', String(willBeListed))
await setOutput('listing_changes', String(listingChanges))
await setOutput('existing_scenes', String(replaced))
await setOutput('permission', permission)

const lines = [
  `## Deploy plan for \`${world}\``,
  '',
  `**${title}** · ${parcels.length} parcel${parcels.length === 1 ? '' : 's'} · target \`${targetContent}\``,
  '',
  '| Check | Result |',
  '| --- | --- |',
  `| Known to the places service | ${isRegistered ? 'yes' : 'no, this deploy registers it'} |`,
  `| Publicly listed | ${isListed ? 'yes' : 'no'} → ${willBeListed ? 'yes' : 'no'}${listingChanges ? ' ⚠️ **changes**' : ''} |`,
  `| Scenes in the world now | ${replaced} |`,
  `| This deploy | ${replaced > 0 ? `**replaces** the ${replaced} scene${replaced === 1 ? '' : 's'} below` : 'is the first scene in this world'} |`,
  `| Deploying wallet | ${deployer ? permission : 'not checked (set the DEPLOYER_ADDRESS variable)'} |`,
  '',
]

if (listingChanges && willBeListed) {
  lines.push(
    '> After this deploy the world becomes publicly listed and discoverable.',
    '> Set `worldConfiguration.placesConfig.optOut` in scene.json to keep it unlisted.',
    '',
  )
}

if (listingChanges && !willBeListed) {
  lines.push(
    '> This scene opts out, so the world stops being publicly listed.',
    '',
  )
}

if (replaced > 0) {
  lines.push(
    `> Deploying replaces the scene${replaced === 1 ? '' : 's'} already in this world.`,
    '> Pass `--multi-scene` if it should be added alongside them instead.',
    '',
  )
  for (const s of existing) {
    lines.push(`- \`${s.entityId}\` — ${(s.parcels ?? []).length} parcels`)
  }
  lines.push('')
}

await summary(lines.join('\n'))

if (permission === 'denied') {
  console.error(`The deploying wallet has no deployment permission on ${world}.`)
  process.exit(1)
}
