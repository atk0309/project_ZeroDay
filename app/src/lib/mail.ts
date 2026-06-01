// Provider-agnostic mail wrapper. Reads provider + creds from app_settings,
// not env, so the admin console can swap providers at runtime.
//
// Supported providers:
//   resend  — credentials = { apiKey: string }
//   smtp    — credentials = { host, port, secure, user, pass }
//
// Send paths intentionally lazy-import their SDKs so a misconfigured provider
// can't crash boot.

import * as settings from './settings.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailResult {
  ok: boolean;
  provider: string;
  id?: string;
  error?: string;
}

interface ResendCreds { apiKey: string }
interface SmtpCreds {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}

function loadProvider(): { provider: string; creds: unknown; from: string } | null {
  const provider = settings.get('mail_provider');
  const credsStr = settings.get('mail_credentials');
  const from = settings.get('mail_from') ?? 'recruit@example.com';
  if (!provider || !credsStr) return null;
  try {
    return { provider, creds: JSON.parse(credsStr), from };
  } catch {
    return null;
  }
}

export function isConfigured(): boolean {
  return settings.get('mail_configured') === 'true' && loadProvider() !== null;
}

export async function send(msg: MailMessage): Promise<MailResult> {
  const cfg = loadProvider();
  if (!cfg) return { ok: false, provider: 'none', error: 'mail not configured' };

  try {
    if (cfg.provider === 'resend') {
      const { Resend } = await import('resend');
      const creds = cfg.creds as ResendCreds;
      const client = new Resend(creds.apiKey);
      const r = await client.emails.send({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      if (r.error) return { ok: false, provider: 'resend', error: r.error.message };
      return { ok: true, provider: 'resend', id: r.data?.id };
    }

    if (cfg.provider === 'smtp') {
      const nodemailer = await import('nodemailer');
      const creds = cfg.creds as SmtpCreds;
      const transport = nodemailer.createTransport({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth: { user: creds.user, pass: creds.pass },
      });
      const r = await transport.sendMail({
        from: cfg.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      });
      return { ok: true, provider: 'smtp', id: r.messageId };
    }

    return { ok: false, provider: cfg.provider, error: 'unknown provider' };
  } catch (e) {
    return { ok: false, provider: cfg.provider, error: e instanceof Error ? e.message : String(e) };
  }
}

// Test-send: sends a canary message to the admin email. Used by /admin/setup
// to flip mail_configured = true only after a real round-trip.
export async function sendTest(toAdminEmail: string): Promise<MailResult> {
  return send({
    to: toAdminEmail,
    subject: '[ZeroDay] mail subsystem online',
    text: 'transmission received. mail subsystem is online. — wopr',
    html: '<pre>transmission received.\nmail subsystem is online.\n— wopr</pre>',
  });
}

// ─── Boot-time env seeding ─────────────────────────────────────────
// First-boot convenience: read MAIL_* env vars and write them into
// app_settings if (and only if) mail_provider is currently unset. After
// that the admin console is the single source of truth — env edits are
// ignored unless the row is wiped (DELETE FROM app_settings WHERE key LIKE
// 'mail_%').
//
// We never set mail_configured=true here. Operators still have to run the
// /admin/setup/mail/test round-trip so a real send is verified before the
// magic-link button on /admin/login becomes active.

export type SeedReason =
  | 'env-missing'
  | 'already-configured'
  | 'unknown-provider'
  | 'incomplete-resend'
  | 'incomplete-smtp';

export interface SeedResult {
  seeded: 'resend' | 'smtp' | null;
  reason?: SeedReason;
}

export function seedFromEnv(env: NodeJS.ProcessEnv = process.env): SeedResult {
  // Provider is inferred from companion creds when MAIL_PROVIDER isn't set,
  // so a Railway service can seed by setting just MAIL_RESEND_API_KEY (or the
  // SMTP host) — no need to also set MAIL_PROVIDER alongside it.
  let provider = (env.MAIL_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) {
    if ((env.MAIL_RESEND_API_KEY ?? '').trim()) provider = 'resend';
    else if ((env.MAIL_SMTP_HOST ?? '').trim()) provider = 'smtp';
  }
  if (!provider) return { seeded: null, reason: 'env-missing' };

  // Admin owns mail config once it's set in the DB. Env edits don't override.
  if (settings.getFresh('mail_provider')) {
    return { seeded: null, reason: 'already-configured' };
  }

  let creds: ResendCreds | SmtpCreds;
  if (provider === 'resend') {
    const apiKey = (env.MAIL_RESEND_API_KEY ?? '').trim();
    if (!apiKey) return { seeded: null, reason: 'incomplete-resend' };
    creds = { apiKey };
  } else if (provider === 'smtp') {
    const host = (env.MAIL_SMTP_HOST ?? '').trim();
    const port = Number.parseInt(env.MAIL_SMTP_PORT ?? '', 10);
    const user = (env.MAIL_SMTP_USER ?? '').trim();
    const pass = env.MAIL_SMTP_PASS ?? '';
    const secure = (env.MAIL_SMTP_SECURE ?? 'false').toLowerCase() === 'true';
    if (!host || !Number.isFinite(port) || !user || !pass) {
      return { seeded: null, reason: 'incomplete-smtp' };
    }
    creds = { host, port, secure, user, pass };
  } else {
    return { seeded: null, reason: 'unknown-provider' };
  }

  const from = (env.MAIL_FROM ?? '').trim();
  const entries: Parameters<typeof settings.setMany>[0] = {
    mail_provider: provider,
    mail_credentials: JSON.stringify(creds),
  };
  if (from) entries.mail_from = from;
  settings.setMany(entries);

  return { seeded: provider as 'resend' | 'smtp' };
}
