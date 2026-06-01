// Public privacy policy + cookie disclosure page. Pairs with the consent
// banner injected by the onSend hook in server.ts and the client-side
// gate in web/static/consent.js.

import type { FastifyInstance } from 'fastify';

export async function privacyRoutes(app: FastifyInstance) {
  app.get('/privacy', async (_req, reply) => {
    return reply.view('privacy.ejs', {});
  });
}
