import { describe, it, expect, beforeEach } from 'vitest';
import { applySchema } from './helpers.js';
import * as settings from '../src/lib/settings.js';
import {
  renderTemplate,
  recruitEmailBody,
  recruitEmailSubject,
  lobbyFlavorLines,
  seedDefaults,
  acceptConfirmEmailBody,
  acceptConfirmEmailSubject,
  requestReceivedEmailBody,
  requestApprovedEmailBody,
  requestDeniedEmailBody,
  adminNoteBlock,
  DEFAULT_RECRUIT_EMAIL_BODY,
  DEFAULT_LOBBY_FLAVOR,
} from '../src/lib/content.js';

beforeEach(() => {
  applySchema();
  settings.set('recruit_email_body', null);
  settings.set('lobby_flavor', null);
  settings.set('invite_email_subject', null);
  settings.set('invite_email_body', null);
  settings.set('accept_confirm_email_subject', null);
  settings.set('accept_confirm_email_body', null);
  settings.set('request_received_email_subject', null);
  settings.set('request_received_email_body', null);
  settings.set('request_approved_email_subject', null);
  settings.set('request_approved_email_body', null);
  settings.set('request_denied_email_subject', null);
  settings.set('request_denied_email_body', null);
  settings.set('invitations_per_operator', null);
  settings.set('invite_token_ttl', null);
});

describe('renderTemplate', () => {
  it('replaces {token} placeholders with provided values', () => {
    const out = renderTemplate('hello {alias}, key: {magic_link}', {
      alias: 'trinity',
      magic_link: 'https://x/y',
    });
    expect(out).toBe('hello trinity, key: https://x/y');
  });

  it('leaves unknown tokens untouched', () => {
    expect(renderTemplate('value {unknown}', {})).toBe('value {unknown}');
  });
});

describe('seedDefaults', () => {
  it('writes defaults when keys are unset and no-ops on second call', () => {
    const r1 = seedDefaults();
    expect(r1.seeded).toEqual([
      'recruit_email_body',
      'lobby_flavor',
      'invite_email_subject',
      'invite_email_body',
      'accept_confirm_email_subject',
      'accept_confirm_email_body',
      'request_received_email_subject',
      'request_received_email_body',
      'request_approved_email_subject',
      'request_approved_email_body',
      'request_denied_email_subject',
      'request_denied_email_body',
      'invitations_per_operator',
      'invite_token_ttl',
    ]);
    expect(settings.get('recruit_email_body')).toBe(DEFAULT_RECRUIT_EMAIL_BODY);
    expect(settings.get('lobby_flavor')).toBe(DEFAULT_LOBBY_FLAVOR);
    expect(settings.get('invitations_per_operator')).toBe('2');
    expect(settings.get('invite_token_ttl')).toBe('72h');

    const r2 = seedDefaults();
    expect(r2.seeded).toEqual([]);
  });

  it('does not overwrite operator edits, even if cleared to empty string', () => {
    settings.set('recruit_email_body', '');
    settings.set('lobby_flavor', 'just one line');
    settings.set('invite_email_body', '');
    settings.set('invite_email_subject', 'custom');
    settings.set('accept_confirm_email_subject', '');
    settings.set('accept_confirm_email_body', 'welcome {alias}');
    settings.set('request_received_email_subject', '');
    settings.set('request_received_email_body', '');
    settings.set('request_approved_email_subject', '');
    settings.set('request_approved_email_body', '');
    settings.set('request_denied_email_subject', '');
    settings.set('request_denied_email_body', '');
    settings.set('invitations_per_operator', '4');
    settings.set('invite_token_ttl', '24h');
    const r = seedDefaults();
    expect(r.seeded).toEqual([]);
    expect(settings.get('recruit_email_body')).toBe('');
    expect(settings.get('lobby_flavor')).toBe('just one line');
    expect(settings.get('invite_email_body')).toBe('');
    expect(settings.get('invite_email_subject')).toBe('custom');
    expect(settings.get('accept_confirm_email_body')).toBe('welcome {alias}');
    expect(settings.get('invitations_per_operator')).toBe('4');
    expect(settings.get('invite_token_ttl')).toBe('24h');
  });
});

describe('recruitEmailBody / recruitEmailSubject', () => {
  it('uses the default body when setting is null and interpolates tokens', () => {
    const body = recruitEmailBody({ alias: 'trinity', magic_link: 'https://x/y', expires_in: '15 min' });
    expect(body).toContain('trinity');
    expect(body).toContain('https://x/y');
    expect(body).toContain('15 min');
    expect(body).not.toContain('{alias}');
  });

  it('uses the operator-saved body once stored', () => {
    settings.set('recruit_email_body', 'hi {alias}, link={magic_link}');
    expect(recruitEmailBody({ alias: 'neo', magic_link: 'L', expires_in: '15 min' })).toBe('hi neo, link=L');
  });

  it('renders the subject with expires_in', () => {
    const s = recruitEmailSubject({ alias: 'x', magic_link: 'y', expires_in: '15 min' });
    expect(s).toBe('[ZeroDay] transmission received — 15 min');
  });
});

describe('lobbyFlavorLines', () => {
  it('returns default lines when setting is unset, splitting on \\n', () => {
    const lines = lobbyFlavorLines();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.length > 0)).toBe(true);
  });

  it('returns operator-saved lines once set', () => {
    settings.set('lobby_flavor', 'a\n\nb\nc');
    expect(lobbyFlavorLines()).toEqual(['a', 'b', 'c']);
  });
});

describe('accept-confirm template', () => {
  it('renders the welcome with slot + inviter when default', () => {
    const subject = acceptConfirmEmailSubject({
      alias: 'crash.overr', slot_number: '042', inviter_alias: 'morpheus', lobby_link: 'https://x/'
    });
    expect(subject).toBe('[ZeroDay] welcome, crash.overr');
    const body = acceptConfirmEmailBody({
      alias: 'crash.overr', slot_number: '042', inviter_alias: 'morpheus', lobby_link: 'https://x/'
    });
    expect(body).toContain('crash.overr');
    expect(body).toContain('042');
    expect(body).toContain('morpheus');
    expect(body).toContain('https://x/');
  });

  it('honours operator override', () => {
    settings.set('accept_confirm_email_body', 'hi {alias} go to {lobby_link}');
    expect(acceptConfirmEmailBody({
      alias: 'neo', slot_number: '01', inviter_alias: 'm', lobby_link: 'L'
    })).toBe('hi neo go to L');
  });
});

describe('request-flow templates', () => {
  it('request_received renders requester + reason + admin link', () => {
    const body = requestReceivedEmailBody({
      requester_alias: 'acid_burn',
      requester_email: 'a@x',
      invitee_email: 'b@x',
      reason: 'study group',
      admin_link: 'https://x/admin',
    });
    expect(body).toContain('acid_burn');
    expect(body).toContain('a@x');
    expect(body).toContain('b@x');
    expect(body).toContain('study group');
    expect(body).toContain('https://x/admin');
  });

  it('request_approved interpolates note_block from adminNoteBlock', () => {
    const body = requestApprovedEmailBody({
      requester_alias: 'acid_burn',
      invitee_email: 'b@x',
      note: 'good ask',
      note_block: adminNoteBlock('good ask'),
      lobby_link: 'https://x/',
    });
    expect(body).toContain('the admin wrote:');
    expect(body).toContain('good ask');
    expect(body).toContain('b@x');
  });

  it('request_approved with empty note collapses cleanly', () => {
    const body = requestApprovedEmailBody({
      requester_alias: 'acid_burn',
      invitee_email: 'b@x',
      note: '',
      note_block: adminNoteBlock(''),
      lobby_link: 'https://x/',
    });
    expect(body).not.toContain('the admin wrote');
    expect(body).not.toContain('{note_block}');
  });

  it('request_denied surfaces the admin reason', () => {
    const body = requestDeniedEmailBody({
      requester_alias: 'acid_burn',
      invitee_email: 'b@x',
      note: 'cohort full',
      lobby_link: 'https://x/',
    });
    expect(body).toContain('cohort full');
    expect(body).toContain('acid_burn');
  });
});

describe('adminNoteBlock', () => {
  it('returns empty string for missing/blank input', () => {
    expect(adminNoteBlock(null)).toBe('');
    expect(adminNoteBlock(undefined)).toBe('');
    expect(adminNoteBlock('')).toBe('');
    expect(adminNoteBlock('   ')).toBe('');
  });

  it('formats a non-empty note as a prose block', () => {
    expect(adminNoteBlock('looks good')).toBe('the admin wrote:\n  looks good\n\n');
  });
});
