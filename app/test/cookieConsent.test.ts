// Cookie consent banner injection. Verifies the onSend hook in server.ts
// splices the bootstrap into public HTML responses, leaves admin/api/static
// untouched, and threads CLARITY_PROJECT_ID through to the client-side gate.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { applySchema } from './helpers.js';
import { build } from '../src/server.js';

beforeAll(() => {
  applySchema();
});

afterEach(() => {
  delete process.env.CLARITY_PROJECT_ID;
});

describe('cookie consent banner injection', () => {
  it('injects the bootstrap on a public HTML page', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toContain('/static/consent.js');
    expect(r.body).toContain('/static/consent.css');
    expect(r.body).toContain('window.__zdConsent');
  });

  it('renders clarityId as empty string when CLARITY_PROJECT_ID is unset', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    expect(r.body).toContain('clarityId:""');
  });

  it('threads CLARITY_PROJECT_ID through to the bootstrap', async () => {
    process.env.CLARITY_PROJECT_ID = 'test-clarity-id';
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    expect(r.body).toContain('clarityId:"test-clarity-id"');
  });

  it('strips unsafe characters from CLARITY_PROJECT_ID before injection', async () => {
    process.env.CLARITY_PROJECT_ID = 'abc"</script><script>alert(1)';
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    expect(r.body).toContain('clarityId:"abcscriptscriptalert1"');
    expect(r.body).not.toContain('alert(1)');
  });

  it('splices the snippet immediately before </body>', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    const scriptIdx = r.body.indexOf('/static/consent.js');
    const bodyCloseIdx = r.body.toLowerCase().lastIndexOf('</body>');
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(bodyCloseIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyCloseIdx);
  });

  it('does NOT inject on admin pages', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/admin/login' });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('/static/consent.js');
    expect(r.body).not.toContain('window.__zdConsent');
  });

  it('does NOT inject on JSON API responses', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/api/leaderboard' });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/json/);
    expect(r.body).not.toContain('consent.js');
  });

  it('does NOT inject on static asset responses', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/static/consent.css' });
    expect(r.statusCode).toBe(200);
    expect(r.body).not.toContain('window.__zdConsent');
  });

  it('serves /privacy?<query> through the privacy handler (not challenge dispatch on the hub host)', async () => {
    const app = await build();
    const r = await app.inject({
      method: 'GET',
      url: '/privacy?utm_source=twitter&ref=test',
      headers: { host: 'hack.example.com' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/html/);
    expect(r.body).toMatch(/do not sell your data/i);
  });

  it('serves /privacy as a 200 HTML page with the no-sell pledge', async () => {
    const app = await build();
    const r = await app.inject({ method: 'GET', url: '/privacy' });
    expect(r.statusCode).toBe(200);
    expect(r.body).toMatch(/do not sell your data/i);
    expect(r.body).toContain('Microsoft Clarity');
    expect(r.body).toContain('Cloudflare Web Analytics');
  });
});
