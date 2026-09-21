# Deploying the world from CI

The `Deploy world` workflow deploys this scene to the Decentraland world named in
`scene.json` (`worldConfiguration.name`). It is manual only, and it pauses for a
human to approve before anything is signed or uploaded.

## What a run does

1. **Inspect.** Checks that the world name you typed matches `scene.json`, installs,
   runs the tests and the build, then reports what the deploy would do:
   - whether a **new place entry** will be created, or one already exists
   - how many scenes the world holds now, and whether this deploy replaces them
   - whether the deploying wallet is allowed to deploy to that world

   Nothing is signed or uploaded in this stage.

2. **Approve.** The deploy job targets the `world-deploy` environment. With a required
   reviewer configured, the run waits here and the reviewer sees the inspect summary
   before deciding.

3. **Deploy.** Builds and deploys, signing with the wallet key from the environment.

## One-time setup

Repository settings → Environments → **New environment** named `world-deploy`:

- **Required reviewers**: add at least one person. This is the approval gate. Without
  it the deploy job runs straight through and nobody is asked.
- **Secret** `DCL_PRIVATE_KEY`: the deploying wallet's private key. `sdk-commands`
  reads it to sign without a browser. Keep it on the environment, not the repository,
  so it is only readable by the job that waits for approval.

Repository settings → Secrets and variables → Actions → Variables:

- **Variable** `DEPLOYER_ADDRESS`: the deploying wallet's address, for example
  `0x0000000000000000000000000000000000000000`. Optional. When set, the inspect stage
  checks the world's permissions and fails early instead of at signing time.

## Running it

Actions → **Deploy world** → Run workflow, then:

- **confirm** — type the world name exactly as it appears in `scene.json`. This is
  what stops a deploy aimed at the wrong world.
- **target_content** — leave as is for production.
- **multi_scene** — off by default, which replaces the scenes already in the world.
  Turn it on to add this scene alongside them.

## Checking the plan without deploying

The same report runs locally and needs no credentials:

```bash
node scripts/check-world-deployment.mjs
```
