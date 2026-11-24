// Browser crash reports (sent by src/js/site.js), passed on to Sentry by server/monitor.js.
import { route, clientIp, rateLimit } from '../lib/http.js';
import { reportClientError, errorTrackingOn } from '../monitor.js';

route('POST', 'client-error', async (ctx) => {
  if (!errorTrackingOn()) return { ok: true };
  await rateLimit(`clienterr:${clientIp(ctx.req)}`, 20, 3600);
  await reportClientError(ctx.body, ctx.req.headers.get('user-agent'));
  return { ok: true };
});
