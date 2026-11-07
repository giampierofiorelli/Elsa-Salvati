// Media library storage: images (only the versions the site delivers) and PDFs.
// Kept apart from lib/db.mjs so the page store stays small.

const COLS = `m.id, m.kind, m.name, m.role, m.width, m.height, m.alt_it, m.alt_en, m.bytes_total, m.created_at,
  (select name from users u where u.id = m.created_by) as created_by_name`;

export function createMediaStore(sql) {
  return {
    async insertMedia(m, files) {
      await sql.begin(async (tx) => {
        await tx`insert into media (id, kind, name, role, width, height, alt_it, alt_en, bytes_total, created_by)
          values (${m.id}, ${m.kind}, ${m.name}, ${m.role ?? null}, ${m.width ?? null}, ${m.height ?? null},
                  ${m.alt_it || ''}, ${m.alt_en || ''}, ${m.bytes_total}, ${m.created_by ?? null})`;
        for (const f of files) {
          await tx`insert into media_files (media_id, variant, mime, width, height, bytes)
            values (${m.id}, ${f.variant}, ${f.mime}, ${f.width ?? null}, ${f.height ?? null}, ${f.bytes})`;
        }
      });
    },
    async listMedia() {
      return sql.unsafe(`select ${COLS},
          coalesce((select array_agg(f.variant order by f.variant) from media_files f where f.media_id = m.id), '{}') as variants
        from media m order by m.created_at desc limit 500`);
    },
    async getMedia(id) {
      const [row] = await sql.unsafe(`select ${COLS},
          coalesce((select array_agg(f.variant order by f.variant) from media_files f where f.media_id = m.id), '{}') as variants
        from media m where m.id = $1`, [id]);
      return row || null;
    },
    async updateMedia(id, patch) {
      const cols = Object.keys(patch).filter((k) => ['name', 'alt_it', 'alt_en'].includes(k));
      if (!cols.length) return;
      await sql`update media set ${sql(patch, cols)} where id = ${id}`;
    },
    async deleteMedia(id) {
      const rows = await sql`delete from media where id = ${id} returning id`;
      return rows.length > 0;
    },
    async getMediaFile(id, variant) {
      const [row] = await sql`select f.mime, f.bytes, m.name from media_files f join media m on m.id = f.media_id
        where f.media_id = ${id} and f.variant = ${variant}`;
      return row || null;
    },
    /** Every place that holds content: pages (draft and published) and, if present, header/footer/studio. */
    async contentSources() {
      const pages = await sql`select key, lang, path, draft->>'title' as title, draft::text as draft, coalesce(published::text, '') as published
        from site_pages`;
      const out = pages.map((p) => ({ type: 'page', key: p.key, lang: p.lang, path: p.path, title: p.title, draft: p.draft, published: p.published }));
      const [g] = await sql`select to_regclass('site_globals') is not null as present`;
      if (g && g.present) {
        const rows = await sql.unsafe('select scope, draft::text as draft, coalesce(published::text, \'\') as published from site_globals');
        for (const r of rows) out.push({ type: 'globals', key: r.scope, lang: r.scope === 'studio' ? null : r.scope, path: null, title: r.scope === 'studio' ? 'Dati dello studio' : 'Intestazione e piè di pagina', draft: r.draft, published: r.published });
      }
      return out;
    },
  };
}

/** Where a media id appears (draft and/or published), from the content sources. */
export function usageOf(id, sources) {
  const needle = `"${id}"`;
  const pdf = `/media/${id}.pdf`;
  return sources.map((s) => {
    const inDraft = s.draft.includes(needle) || s.draft.includes(pdf);
    const inPublished = s.published.includes(needle) || s.published.includes(pdf);
    if (!inDraft && !inPublished) return null;
    return { type: s.type, key: s.key, lang: s.lang, path: s.path, title: s.title, draft: inDraft, published: inPublished };
  }).filter(Boolean);
}
