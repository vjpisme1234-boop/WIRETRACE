# Golden Set — Accuracy Testing

This folder holds hand-verified "correct answer" data for real, photographed
schematics. It's the only honest way to measure whether a prompt or model
change actually improved accuracy — without it, every tweak is a guess.

**This folder is currently empty.** It needs real entries: an actual photo of
a real schematic, plus the correct wires/components/connections written down
by hand by someone who can verify them (an electrician, or whoever scanned
it and fixed every mistake using the in-app correction tools). Nothing in
this repo fabricates or assumes example data — do not treat any sample below
as real.

## Entry format

Each entry is a JSON file matching the `GoldenSchematic` type in
`utils/accuracy-scoring.ts`:

```json
{
  "id": "conveyor-panel-4",
  "imagePath": "./conveyor-panel-4.jpg",
  "wires": [
    { "label": "14", "fromPoint": "TB1-1", "toPoint": "CR1-A1", "color": "red" }
  ],
  "components": [
    { "label": "CR1", "type": "relay" }
  ],
  "connections": [
    { "from": "TB1-1", "to": "CR1-A1", "wireLabel": "14" }
  ]
}
```

- `id` — a short, unique name for this schematic
- `imagePath` — relative path to the reference photo (add it alongside the JSON file)
- `wires` / `components` / `connections` — the actual, human-verified correct values, in the same shape the AI is asked to produce

## Adding an entry

1. Scan a real schematic in the app as normal.
2. Use the correction UI to fix every mistake until it's 100% right.
3. Export that verified data into a JSON file here matching the format above (a small export helper can be added once there are entries worth exporting — for now, copying the corrected values by hand is fine for a handful of schematics).
4. Add the reference photo alongside it.

## Running the eval

`utils/golden-set-eval.ts` exports `runGoldenSetEval(entries)`, which sends
each entry's image through the real analysis pipeline (real AI call, real
provider fallback) and scores the result against its ground truth using
`utils/accuracy-scoring.ts`. It needs to run inside the app (not a standalone
script) since it reuses the real `analyzeSchematic` call — wire it up to a
debug button or dev screen once there are entries to run it against.
