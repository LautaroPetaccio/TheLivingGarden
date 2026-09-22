# Agent instructions

## A change ships with its tests

Every change lands together with the test that proves it. No exceptions for
"small" edits: the ones that look too small to test are the ones that regress
quietly.

- **A bug fix needs a test that fails before the fix and passes after it.**
  Write it first, watch it fail, then fix. "The suite still passes" is not proof
  that the reported problem is gone.
- **New behaviour needs a test per branch a caller can reach**, including the
  failure paths. A function that can return, throw and time out needs all three.
- **Changing existing behaviour means updating the test that pinned the old
  behaviour**, in the same commit. If no test had to change, check whether the
  behaviour was covered at all.
- If something genuinely cannot be tested here, say so in the pull request and
  explain why, rather than leaving it silent.

The reliable way to earn that is to **write the test first and watch it fail**,
before the fix exists. Then make it pass. A test written afterwards often passes
against the broken code too, and nobody finds out.

If the fix is already written, take it away and re-run:

```bash
git stash push -- src/server/     # or whichever paths you edited
npm test                          # the new tests must FAIL here
git stash pop
```

Two ways that check can lie to you, both of which show green and prove nothing:

- `git stash` only moves **uncommitted** work. On a clean tree it is a no-op.
- `git checkout <base> -- <path>` restores files the base already had, but does
  not delete files your branch added, so a new module stays in place.

If the change is committed, the honest check is a scratch worktree on the base
with only the test files copied in.

## Running them

```bash
npm test          # Jest via ts-jest
```

Specs live in `test/`, named `*.spec.ts`. They are deliberately **not** beside
the code they cover: the scene `tsconfig.json` pins `types` to `@dcl/js-runtime`
and `sdk-commands build` type-checks all of `src/`, so a spec under `src/` fails
the build on Jest's globals. `tsconfig.test.json` adds those types for the test
program only.

`test/` and `scripts/` are in `.dclignore`, so neither is uploaded with the scene.

## How tests are written

- `describe` carries the context and reads as a sentence: `when ...` for the
  outer case, `and ...` for nested ones.
- `it` states one expected behaviour: `should ...`. Do not put `when` in an `it`.
- Declare mocks and inputs in the `beforeEach` of the context that uses them,
  never inside an `it` body, and never globally when only one context needs them.
- Be specific. `should reject a failed read rather than resolve null` beats
  `should work`.

## Before opening a pull request

```bash
npx tsc --noEmit -p tsconfig.json    # scene
npm test
npm run build
```

`npm run build` regenerates `main.crdt`. Leave that out of the commit unless the
scene content is what you changed.

See `claude.md` for the working directives that apply while making the change.
