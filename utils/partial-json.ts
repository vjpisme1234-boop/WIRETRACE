// Rescues partial data out of a JSON response that got cut off or slightly
// malformed instead of discarding the whole thing. Used as a last-resort
// fallback when a normal JSON.parse (even with the outer-brace retry)
// fails — walks the raw text field-by-field and salvages whatever
// individual array elements parsed cleanly before the point of truncation.

function extractField(raw: string, key: string): unknown {
  const keyPattern = new RegExp(`"${key}"\\s*:\\s*`);
  const match = keyPattern.exec(raw);
  if (!match || match.index === undefined) return undefined;
  const start = match.index + match[0].length;
  const firstChar = raw[start];

  if (firstChar === '[' || firstChar === '{') {
    const open = firstChar;
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === open) depth++;
      else if (ch === close) {
        depth--;
        if (depth === 0) {
          const slice = raw.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch {
            break;
          }
        }
      }
    }
    // The array/object itself was truncated — salvage whatever complete
    // elements exist before the cutoff instead of returning nothing.
    if (open === '[') {
      return salvagePartialArray(raw.slice(start + 1));
    }
    return undefined;
  }

  if (firstChar === '"') {
    let i = start + 1;
    let out = '';
    let escape = false;
    for (; i < raw.length; i++) {
      const ch = raw[i];
      if (escape) {
        out += ch;
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') break;
      out += ch;
    }
    return out;
  }

  const rest = raw.slice(start);
  const m = rest.match(/^(true|false|null|-?\d+(\.\d+)?)/);
  return m ? JSON.parse(m[0]) : undefined;
}

function salvagePartialArray(fragment: string): unknown[] {
  const items: unknown[] = [];
  let i = 0;
  while (i < fragment.length) {
    while (i < fragment.length && /[\s,]/.test(fragment[i])) i++;
    if (fragment[i] !== '{') break;
    const start = i;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (; i < fragment.length; i++) {
      const ch = fragment[i];
      if (inString) {
        if (escape) escape = false;
        else if (ch === '\\') escape = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          i++;
          break;
        }
      }
    }
    if (depth !== 0) break; // unterminated — this is the truncation point, stop here
    const slice = fragment.slice(start, i);
    try {
      items.push(JSON.parse(slice));
    } catch {
      break;
    }
  }
  return items;
}

export interface SalvagedAnalysis {
  wires: unknown[];
  components: unknown[];
  connections: unknown[];
  unknownSymbols: unknown[];
  summary: string;
  startPointAmbiguous?: boolean;
}

export function salvagePartialAnalysis(rawContent: string): SalvagedAnalysis {
  const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const wires = extractField(cleaned, 'wires');
  const components = extractField(cleaned, 'components');
  const connections = extractField(cleaned, 'connections');
  const unknownSymbols = extractField(cleaned, 'unknownSymbols');
  const summary = extractField(cleaned, 'summary');
  const startPointAmbiguous = extractField(cleaned, 'startPointAmbiguous');

  return {
    wires: Array.isArray(wires) ? wires : [],
    components: Array.isArray(components) ? components : [],
    connections: Array.isArray(connections) ? connections : [],
    unknownSymbols: Array.isArray(unknownSymbols) ? unknownSymbols : [],
    summary: typeof summary === 'string' ? summary : '',
    startPointAmbiguous: typeof startPointAmbiguous === 'boolean' ? startPointAmbiguous : undefined,
  };
}

/** Same rescue as salvagePartialAnalysis, for the reading-steps response
 * shape ({ steps: [...], pendingChoice: ... }). A truncated pendingChoice
 * object can't be trusted, so callers should treat it as absent when
 * salvaging — only the steps array is recovered here. */
export function salvagePartialReadingSteps(rawContent: string): unknown[] {
  const cleaned = rawContent.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  const steps = extractField(cleaned, 'steps');
  return Array.isArray(steps) ? steps : [];
}
