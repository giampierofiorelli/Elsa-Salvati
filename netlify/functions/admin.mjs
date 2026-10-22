import { getDeps } from '../../lib/app.mjs';
import { json } from '../../lib/http.mjs';
import { createAdminApi } from '../../lib/admin-api.mjs';

let handler;

export default async (req, context) => {
  try {
    if (!handler) handler = createAdminApi(getDeps());
  } catch (err) {
    console.error('[setup]', err.message);
    return json(503, { error: 'unavailable', message: 'Servizio temporaneamente non disponibile. Riprova più tardi o contatta lo studio.' });
  }
  return handler(req, context);
};

export const config = { path: '/api/admin/*' };
