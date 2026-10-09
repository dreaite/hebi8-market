/**
 * Which characters a set of fonts can draw, read from their cmap tables, and text cut down to
 * those. The social images use it so next/og never meets a glyph it would download (it fetches
 * Google Fonts for missing characters and twemoji for emoji).
 */

/** The code points a TrueType / OpenType font maps to a glyph (cmap formats 12 and 4). */
export function fontCoverage(data: Buffer): (cp: number) => boolean {
  let cmap = 0;
  for (let i = 0; i < data.readUInt16BE(4); i++) {
    const rec = 12 + i * 16;
    if (data.toString("latin1", rec, rec + 4) === "cmap") cmap = data.readUInt32BE(rec + 8);
  }
  // the Unicode subtable: format 12 (all planes) when there is one, else format 4 (the BMP)
  let table = 0;
  let format = 0;
  for (let i = 0; i < data.readUInt16BE(cmap + 2); i++) {
    const rec = cmap + 4 + i * 8;
    const platform = data.readUInt16BE(rec);
    const offset = cmap + data.readUInt32BE(rec + 4);
    const f = data.readUInt16BE(offset);
    if ((platform === 0 || platform === 3) && (f === 12 || (f === 4 && format !== 12))) {
      table = offset;
      format = f;
    }
  }
  if (format === 12) {
    const groups: [number, number][] = [];
    for (let i = 0; i < data.readUInt32BE(table + 12); i++) groups.push([data.readUInt32BE(table + 16 + i * 12), data.readUInt32BE(table + 20 + i * 12)]);
    return (cp) => groups.some(([start, end]) => cp >= start && cp <= end);
  }
  const segments = data.readUInt16BE(table + 6) / 2;
  const ends = table + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const rangeOffsets = deltas + segments * 2;
  return (cp) => {
    for (let i = 0; i < segments; i++) {
      if (cp > data.readUInt16BE(ends + i * 2)) continue;
      const start = data.readUInt16BE(starts + i * 2);
      if (cp < start) return false;
      const delta = data.readUInt16BE(deltas + i * 2);
      const rangeOffset = data.readUInt16BE(rangeOffsets + i * 2);
      if (rangeOffset === 0) return ((cp + delta) & 0xffff) !== 0;
      const glyph = data.readUInt16BE(rangeOffsets + i * 2 + rangeOffset + (cp - start) * 2);
      return glyph !== 0;
    }
    return false;
  };
}

/** Anything that makes a grapheme an emoji: pictographs, flag letters, keycaps, emoji presentation */
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣|️/u;
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * `text` without emoji, each dropped as a whole sequence (flags, ZWJ families, keycaps, variation
 * selectors), and without characters `has` does not cover; runs of space become one.
 */
export function fitText(text: string, has: (cp: number) => boolean): string {
  let out = "";
  for (const { segment } of graphemes.segment(text)) {
    if (EMOJI.test(segment)) continue;
    if ([...segment].every((ch) => /\s/.test(ch) || has(ch.codePointAt(0)!))) out += segment;
  }
  return out.replace(/\s+/g, " ").trim();
}
