import { getDeps } from '../../lib/app.mjs';
import { createPublicApi } from '../../lib/public-api.mjs';

let handler;

export default async (req, context) => {
  if (!handler) handler = createPublicApi(getDeps());
  return handler(req, context);
};

export const config = { path: '/api/public/*' };
