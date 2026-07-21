# DeckDoc Format — Version-Bump Policy

- **Status:** Living policy · **Established:** 2026-07-21 (with the object/layer model)

`DeckDoc.version` is the format contract between a deck file and the Morgana engine/editor.
This policy defines when it changes, so schema growth stays predictable and backward-compatible.

## The rule

- **Additive optional fields never bump `version`.** New optional fields on `DeckDoc`, `Scene`,
  `Beat`, `Action`, or `SceneObject` (defaulting to "absent = prior behavior") ship under the
  current `version`. Existing decks stay valid and unchanged; an older Morgana opening a newer
  deck loads it and ignores fields it doesn't understand (graceful degradation).
- **Breaking changes bump `version` and ship a migration.** A breaking change is any of:
  removing or renaming an existing field; changing a field's type or units; changing the meaning
  of an existing value; or making a previously optional field required. These bump `version` by 1,
  and `validateDeckDoc` is updated to accept the new version alongside a migration that upgrades
  older decks on load.

## Consequences

- Load stays pure `JSON.parse`; save stays pure `JSON.stringify`. Migrations, when they exist, run
  as an explicit upgrade step on the parsed object — never a save-time rewrite of untouched decks.
- `Scene.objects` (the object/layer model, 2026-07-21) is the first exercise of this policy: a
  purely additive optional field shipped under `version: 1` with **no** migration.
- This policy is the "format-version freeze + bump policy" prerequisite the end-state design's
  §14a / Q7 names as the trigger for extracting the engine into a package.
