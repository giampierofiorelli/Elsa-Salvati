import { getDeps } from '../../lib/app.mjs';
import { createAdminApi } from '../../lib/admin-api.mjs';

let handler;

export default async (req, context) => {
  if (!handler) handler = createAdminApi(getDeps());
  return handler(req, context);
};

export const config = { path: '/api/admin/*' };
