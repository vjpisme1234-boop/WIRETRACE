# WireTrace AI — 1.0.0 (versionCode 10)

## Play Store "What's new" (paste this — 462 characters, limit is 500)

Big drawings, fixed:

• Large schematics no longer lose wires — the full list comes back complete
• Fixed a crash when a wire runs off the edge of the sheet
• Add your own Google Gemini key in Settings — no scan limit when you use it
• Swipe a wire right to add it to your custom reading order
• Drag to reorder now drops where you put it
• Much bigger schematic image on the analyze screen
• New High Detail scan mode for dense prints

## Longer notes (support page, beta testers, or the store's full description)

**Complete wire lists on large drawings.** On a dense schematic the AI's
answer was being cut off partway through, and the app showed whatever had
arrived as though it were the whole drawing. Wires past the cutoff were
silently missing. The limit is now four times higher, and if a drawing is
ever large enough to hit it, the app says so instead of staying quiet.

**Fixed a crash after a successful scan.** A conductor running off the edge
of the sheet — normal on any multi-sheet print — could crash the app after
the analysis had already finished, losing the scan.

**Bring your own AI key.** Settings now has a slot for a Google Gemini key
alongside Claude, OpenAI and OpenRouter. A free key takes about a minute to
create at aistudio.google.com/apikey. When you use your own key the 20-scan
limit on the built-in AI no longer applies, since Google bills you directly.

**Building a reading order is quicker.** Swipe a wire to the right to drop it
into your list. Dragging to reorder is fixed — rows now land where you put
them instead of springing back or jumping.

**A wire can no longer end up in the list twice.** Adding a wire and tapping
"Add all" at the same moment used to double it up, which meant hearing it
read out twice mid-job.

**The schematic is much bigger** on the analyze screen, with the padding
stripped back so the drawing gets the room.

**High Detail scan mode** (Settings → Scan Detail). Reads the drawing in
three passes — components, then wires, then the printed numbers — and tells
you how many numbers it found and how many it placed. Slower and costs more
per scan, so Standard stays the default; worth switching on for a crowded
print.

**Accurate free-scan count.** The counter could show a number higher than the
limit and push you toward a paid key when you were not actually capped.
