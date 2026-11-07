import { withDeps } from '../../lib/app.mjs';
import { json } from '../../lib/http.mjs';
import { createAdminApi } from '../../lib/admin-api.mjs';
import { loadCatalog } from '../../lib/public-api.mjs';
import { withCatalog } from '../../lib/site-kit.mjs';
import kitData from '../../lib/generated/site-kit.json' with { type: 'json' };

const unavailable = () => json(503, { error: 'unavailable', message: 'Servizio temporaneamente non disponibile. Riprova più tardi o contatta lo studio.' });

export default async (req, context) => {
  try {
    return await withDeps((deps) => createAdminApi({ ...deps, kit: withCatalog(kitData, () => loadCatalog(deps.store)) })(req, context));
  } catch (err) {
    console.error('[setup]', err.message);
    return unavailable();
  }
};

export const config = { path: '/api/admin/*' };
