// Gate for /admin/* routes (except /admin/login). Reads the admin_session cookie.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { SESSION_COOKIE, readSession } from '../lib/adminAuth.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function hostFromUrl(u: string): string | null {
  try {
    return new URL(u).host.toLowerCase();
  } catch {
    return null;
  }
}

// Same-site CSRF defense. SameSite=Strict / Lax cookies still ride on
// requests from sibling subdomains under the same registrable domain (e.g.
// staging.example.com → hack.example.com), so the cookie alone is not a
// sufficient gate for state-changing requests. Match Origin (and fall back to
// Referer) against the request's Host header — same-origin in the strict
// sense, no env config required. Browsers always set Origin on cross-origin
// POSTs, so a CSRF page hosted on a sibling subdomain is rejected here even
// though its cookies attach. If neither header is present (CLI, fastify
// inject, server-to-server) we accept — browser-driven CSRF cannot reach
// that path.
export function isSameOrigin(req: FastifyRequest): boolean {
  const method = (req.method ?? 'GET').toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  const host = (req.headers.host ?? '').split(',')[0].trim().toLowerCase();
  if (!host) return false;

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    if (origin === 'null') return false; // sandboxed iframes / opaque origins
    const oh = hostFromUrl(origin);
    return oh !== null && oh === host;
  }
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.length > 0) {
    const rh = hostFromUrl(referer);
    return rh !== null && rh === host;
  }
  return true;
}

// Returns true if the request was rejected (caller must `return reply`).
export function rejectIfCrossOrigin(
  req: FastifyRequest,
  reply: FastifyReply,
  mode: 'json' | 'html' = 'html',
): boolean {
  if (isSameOrigin(req)) return false;
  if (mode === 'json') {
    reply.code(403).send({ error: 'forbidden: cross-origin request' });
  } else {
    reply.code(403).send('forbidden: cross-origin request');
  }
  return true;
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  if (rejectIfCrossOrigin(req, reply, 'html')) return reply;
  const sid = req.cookies?.[SESSION_COOKIE];
  const sess = readSession(sid);
  if (!sess) {
    return reply.redirect('/admin/login');
  }
  (req as FastifyRequest & { adminEmail?: string }).adminEmail = sess.email;
}
