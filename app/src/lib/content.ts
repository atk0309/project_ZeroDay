// Operator-editable copy: every email the system sends, plus the lobby flavor
// lines. All owned by app_settings and edited from /admin/players?tab=emails
// (the "email templates" workspace). Defaults below are seeded on first boot
// when the keys are literal null; operator edits — including blanks — are
// preserved on subsequent boots.

import * as settings from './settings.js';

export const DEFAULT_SUBJECT = '[ZeroDay] transmission received — {expires_in}';

export const DEFAULT_RECRUIT_EMAIL_BODY = `> {alias},

we watch the lurkers. the ones who open view-source on ordinary pages.
the ones who notice the cursor blink twice. you are one of them.

the key below is keyed to your silhouette. it will not work for anyone
else, and it decays in {expires_in}. one shot.

past the door: nineteen trials, in order, one at a time. one machine
worth breaking at the end. you know the one.

→ decryption key (single-use)
   {magic_link}

— m.
  on behalf of the ones who wait.`;

export const DEFAULT_LOBBY_FLAVOR = `[wopr]   warming up. coffee at 03:14:22.
[wopr]   nodes #1, #4, #7 online.
[wopr]   trinity is reading your packets.
[wopr]   morpheus offered a choice. you took the right one.
[wopr]   the gibson is sleeping. she will wake.
[wopr]   a cursor blinks somewhere in the dark.
[wopr]   T-MINUS {cd}.`;

export const DEFAULT_INVITE_SUBJECT = '[ZeroDay] {inviter_alias} pulled you in';

export const DEFAULT_INVITE_EMAIL_BODY = `> operative,

{inviter_alias} cleared a slot for you. they only get two, and they
spent one on you.

past the door: nineteen trials, in order. one machine worth breaking
at the end.

→ claim your slot (single-use, decays in {expires_in})
   {claim_link}

{note_block}— m.
  on behalf of the ones who wait.`;

export const DEFAULT_ACCEPT_CONFIRM_SUBJECT = '[ZeroDay] welcome, {alias}';

export const DEFAULT_ACCEPT_CONFIRM_BODY = `> {alias},

you're in. slot #{slot_number}. recruiter · {inviter_alias}.

past the door: nineteen trials, in order, one at a time. one machine
worth breaking at the end. you know the one.

→ enter the lobby
   {lobby_link}

— m.
  on behalf of the ones who wait.`;

export const DEFAULT_REQUEST_RECEIVED_SUBJECT = '[ZeroDay] {requester_alias} requests an extra slot';

export const DEFAULT_REQUEST_RECEIVED_BODY = `> admin,

{requester_alias} has used both of their invites and is asking for one
more.

  requester · {requester_alias} <{requester_email}>
  for       · {invitee_email}
  reason    · {reason}

decide it here:
   {admin_link}

— wopr`;

export const DEFAULT_REQUEST_APPROVED_SUBJECT = '[ZeroDay] request approved · invite dispatched';

export const DEFAULT_REQUEST_APPROVED_BODY = `> {requester_alias},

your request for an extra slot was approved.

{invitee_email} just got the invite. no further action from you.

{note_block}→ back to the lobby
   {lobby_link}

— m.
  on behalf of the ones who wait.`;

export const DEFAULT_REQUEST_DENIED_SUBJECT = '[ZeroDay] request denied';

export const DEFAULT_REQUEST_DENIED_BODY = `> {requester_alias},

your request for an extra slot was denied.

  reason · {note}

no hard feelings · keep grinding the trials.

— the admin.`;

export type RecruitTokens = {
  alias: string;
  magic_link: string;
  expires_in: string;
} & Record<string, string>;

// Token interpolation is intentionally dumb-stringy: we replace `{name}` with
// the value verbatim. No escaping happens here — the recruit email is plain
// text only, so HTML injection is a non-issue. If we ever add an HTML body,
// escape at the call site.
export function renderTemplate(tpl: string, tokens: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m
  );
}

export function recruitEmailBody(tokens: RecruitTokens): string {
  const tpl = settings.get('recruit_email_body') ?? DEFAULT_RECRUIT_EMAIL_BODY;
  return renderTemplate(tpl, tokens);
}

export function recruitEmailSubject(tokens: RecruitTokens): string {
  return renderTemplate(DEFAULT_SUBJECT, tokens);
}

export function lobbyFlavorLines(): string[] {
  const raw = settings.get('lobby_flavor');
  const src = (raw == null || raw === '') ? DEFAULT_LOBBY_FLAVOR : raw;
  return src.split('\n').filter((l) => l.length > 0);
}

export type InviteTokens = {
  inviter_alias: string;
  claim_link: string;
  expires_in: string;
  note: string;
  note_block: string;
} & Record<string, string>;

export function inviteEmailBody(tokens: InviteTokens): string {
  const tpl = settings.get('invite_email_body') ?? DEFAULT_INVITE_EMAIL_BODY;
  return renderTemplate(tpl, tokens);
}

export function inviteEmailSubject(tokens: InviteTokens): string {
  const tpl = settings.get('invite_email_subject') ?? DEFAULT_INVITE_SUBJECT;
  return renderTemplate(tpl, tokens);
}

// Helper for invite callers: turn an optional note into the prose block we
// interpolate into the email body. Empty / missing notes collapse cleanly.
export function inviteNoteBlock(note: string | null | undefined): string {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return '';
  return `they wrote:\n  ${trimmed}\n\n`;
}

// Helper for request_approved: admin's optional approval note rendered as a
// prose block. Empty notes collapse to an empty string so the surrounding
// template doesn't grow blank lines.
export function adminNoteBlock(note: string | null | undefined): string {
  const trimmed = (note ?? '').trim();
  if (!trimmed) return '';
  return `the admin wrote:\n  ${trimmed}\n\n`;
}

export type AcceptConfirmTokens = {
  alias: string;
  slot_number: string;
  inviter_alias: string;
  lobby_link: string;
} & Record<string, string>;

export function acceptConfirmEmailBody(tokens: AcceptConfirmTokens): string {
  const tpl = settings.get('accept_confirm_email_body') ?? DEFAULT_ACCEPT_CONFIRM_BODY;
  return renderTemplate(tpl, tokens);
}

export function acceptConfirmEmailSubject(tokens: AcceptConfirmTokens): string {
  const tpl = settings.get('accept_confirm_email_subject') ?? DEFAULT_ACCEPT_CONFIRM_SUBJECT;
  return renderTemplate(tpl, tokens);
}

export type RequestReceivedTokens = {
  requester_alias: string;
  requester_email: string;
  invitee_email: string;
  reason: string;
  admin_link: string;
} & Record<string, string>;

export function requestReceivedEmailBody(tokens: RequestReceivedTokens): string {
  const tpl = settings.get('request_received_email_body') ?? DEFAULT_REQUEST_RECEIVED_BODY;
  return renderTemplate(tpl, tokens);
}

export function requestReceivedEmailSubject(tokens: RequestReceivedTokens): string {
  const tpl = settings.get('request_received_email_subject') ?? DEFAULT_REQUEST_RECEIVED_SUBJECT;
  return renderTemplate(tpl, tokens);
}

export type RequestApprovedTokens = {
  requester_alias: string;
  invitee_email: string;
  note: string;
  note_block: string;
  lobby_link: string;
} & Record<string, string>;

export function requestApprovedEmailBody(tokens: RequestApprovedTokens): string {
  const tpl = settings.get('request_approved_email_body') ?? DEFAULT_REQUEST_APPROVED_BODY;
  return renderTemplate(tpl, tokens);
}

export function requestApprovedEmailSubject(tokens: RequestApprovedTokens): string {
  const tpl = settings.get('request_approved_email_subject') ?? DEFAULT_REQUEST_APPROVED_SUBJECT;
  return renderTemplate(tpl, tokens);
}

export type RequestDeniedTokens = {
  requester_alias: string;
  invitee_email: string;
  note: string;
  lobby_link: string;
} & Record<string, string>;

export function requestDeniedEmailBody(tokens: RequestDeniedTokens): string {
  const tpl = settings.get('request_denied_email_body') ?? DEFAULT_REQUEST_DENIED_BODY;
  return renderTemplate(tpl, tokens);
}

export function requestDeniedEmailSubject(tokens: RequestDeniedTokens): string {
  const tpl = settings.get('request_denied_email_subject') ?? DEFAULT_REQUEST_DENIED_SUBJECT;
  return renderTemplate(tpl, tokens);
}

// Boot-time seed. Writes defaults only if the keys are currently unset. Edits
// from /admin/setup persist as empty strings (which we treat as "operator
// cleared it on purpose") so we don't overwrite that — only literal null is
// reseeded.
export function seedDefaults(): { seeded: string[] } {
  const seeded: string[] = [];
  if (settings.getFresh('recruit_email_body') === null) {
    settings.set('recruit_email_body', DEFAULT_RECRUIT_EMAIL_BODY);
    seeded.push('recruit_email_body');
  }
  if (settings.getFresh('lobby_flavor') === null) {
    settings.set('lobby_flavor', DEFAULT_LOBBY_FLAVOR);
    seeded.push('lobby_flavor');
  }
  if (settings.getFresh('invite_email_subject') === null) {
    settings.set('invite_email_subject', DEFAULT_INVITE_SUBJECT);
    seeded.push('invite_email_subject');
  }
  if (settings.getFresh('invite_email_body') === null) {
    settings.set('invite_email_body', DEFAULT_INVITE_EMAIL_BODY);
    seeded.push('invite_email_body');
  }
  if (settings.getFresh('accept_confirm_email_subject') === null) {
    settings.set('accept_confirm_email_subject', DEFAULT_ACCEPT_CONFIRM_SUBJECT);
    seeded.push('accept_confirm_email_subject');
  }
  if (settings.getFresh('accept_confirm_email_body') === null) {
    settings.set('accept_confirm_email_body', DEFAULT_ACCEPT_CONFIRM_BODY);
    seeded.push('accept_confirm_email_body');
  }
  if (settings.getFresh('request_received_email_subject') === null) {
    settings.set('request_received_email_subject', DEFAULT_REQUEST_RECEIVED_SUBJECT);
    seeded.push('request_received_email_subject');
  }
  if (settings.getFresh('request_received_email_body') === null) {
    settings.set('request_received_email_body', DEFAULT_REQUEST_RECEIVED_BODY);
    seeded.push('request_received_email_body');
  }
  if (settings.getFresh('request_approved_email_subject') === null) {
    settings.set('request_approved_email_subject', DEFAULT_REQUEST_APPROVED_SUBJECT);
    seeded.push('request_approved_email_subject');
  }
  if (settings.getFresh('request_approved_email_body') === null) {
    settings.set('request_approved_email_body', DEFAULT_REQUEST_APPROVED_BODY);
    seeded.push('request_approved_email_body');
  }
  if (settings.getFresh('request_denied_email_subject') === null) {
    settings.set('request_denied_email_subject', DEFAULT_REQUEST_DENIED_SUBJECT);
    seeded.push('request_denied_email_subject');
  }
  if (settings.getFresh('request_denied_email_body') === null) {
    settings.set('request_denied_email_body', DEFAULT_REQUEST_DENIED_BODY);
    seeded.push('request_denied_email_body');
  }
  if (settings.getFresh('invitations_per_operator') === null) {
    settings.set('invitations_per_operator', '2');
    seeded.push('invitations_per_operator');
  }
  if (settings.getFresh('invite_token_ttl') === null) {
    settings.set('invite_token_ttl', '72h');
    seeded.push('invite_token_ttl');
  }
  return { seeded };
}
