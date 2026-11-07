// Internal notes in hand-written pages and partials: visible on staging and previews, removed in production.
// Only our own markers are removed, never arbitrary text in brackets:
// - <p|div|li|span class="placeholder-note">…</…>: the yellow draft boxes;
// - <span class="draft-inline">…</span>: a short note inside a sentence (the leading space sits inside the span);
// - <!-- Nota bozza: … --> and <!-- Draft note: … -->: notes in the source.
// Notes never contain an element of their own tag, so the shortest match is the whole note.
const BOX = /<(p|div|li|span)\s+class="placeholder-note"[^>]*>[\s\S]*?<\/\1>\s*/g;
const INLINE = /<span\s+class="draft-inline"[^>]*>[\s\S]*?<\/span>/g;
const COMMENT = /<!--\s*(?:Nota bozza|Draft note)\b[\s\S]*?-->/gi;

export function stripDraftNotes(html) {
  return String(html).replace(COMMENT, '').replace(BOX, '').replace(INLINE, '');
}
