// Operator → admin "give me a 3rd slot" requests.
// At most one pending row per requester. Approval spawns an invitations row
// with source='admin_grant' (bypassQuota=true) and links it back via
// granted_invitation_id.

import { db } from '../db/index.js';
import { createInvitation, type Invitation } from './invitations.js';

export type RequestStatus = 'pending' | 'approved' | 'denied';

export interface InviteRequest {
  id: number;
  requester_id: number;
  invitee_email: string | null;
  reason: string;
  status: RequestStatus;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  decision_note: string | null;
  granted_invitation_id: number | null;
}

const insertReq = db.prepare(`
  INSERT INTO invite_requests (requester_id, invitee_email, reason)
  VALUES (?, ?, ?)
`);

const selectById = db.prepare(`SELECT * FROM invite_requests WHERE id = ?`);

const selectPendingForRequester = db.prepare(`
  SELECT id FROM invite_requests
  WHERE requester_id = ? AND status = 'pending' LIMIT 1
`);

const selectAllJoined = db.prepare(`
  SELECT r.*, u.alias AS requester_alias
  FROM invite_requests r
  LEFT JOIN users u ON u.id = r.requester_id
  ORDER BY r.created_at DESC
`);

const selectPendingJoined = db.prepare(`
  SELECT r.*, u.alias AS requester_alias
  FROM invite_requests r
  LEFT JOIN users u ON u.id = r.requester_id
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC
`);

const selectForRequester = db.prepare(`
  SELECT * FROM invite_requests
  WHERE requester_id = ?
  ORDER BY created_at DESC
`);

const markApprovedStmt = db.prepare(`
  UPDATE invite_requests
  SET status = 'approved', decided_at = datetime('now'), decided_by = ?,
      decision_note = ?, granted_invitation_id = ?
  WHERE id = ? AND status = 'pending'
`);

const markDeniedStmt = db.prepare(`
  UPDATE invite_requests
  SET status = 'denied', decided_at = datetime('now'), decided_by = ?,
      decision_note = ?
  WHERE id = ? AND status = 'pending'
`);

export class InviteRequestError extends Error {
  code: 'pending_exists' | 'invalid';
  constructor(code: 'pending_exists' | 'invalid', message?: string) {
    super(message ?? code);
    this.code = code;
  }
}

export interface CreateRequestArgs {
  requesterId: number;
  inviteeEmail: string | null;
  reason: string;
}

export function createRequest(args: CreateRequestArgs): InviteRequest {
  const reason = (args.reason ?? '').trim().slice(0, 500);
  if (!reason) throw new InviteRequestError('invalid', 'reason required');
  const email = args.inviteeEmail ? args.inviteeEmail.trim().toLowerCase() : null;

  let result!: InviteRequest;
  const tx = db.transaction(() => {
    const dup = selectPendingForRequester.get(args.requesterId) as { id: number } | undefined;
    if (dup) throw new InviteRequestError('pending_exists');
    const r = insertReq.run(args.requesterId, email, reason);
    result = selectById.get(r.lastInsertRowid) as InviteRequest;
  });
  tx();
  return result;
}

export function findById(id: number): InviteRequest | null {
  return (selectById.get(id) as InviteRequest | undefined) ?? null;
}

export function listAll(): (InviteRequest & { requester_alias: string })[] {
  return selectAllJoined.all() as (InviteRequest & { requester_alias: string })[];
}

export function listPending(): (InviteRequest & { requester_alias: string })[] {
  return selectPendingJoined.all() as (InviteRequest & { requester_alias: string })[];
}

export function listForRequester(userId: number): InviteRequest[] {
  return selectForRequester.all(userId) as InviteRequest[];
}

export type ApproveResult =
  | { ok: true; invitation: Invitation }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'no_email' };

export function approveRequest(args: { id: number; adminEmail: string; note: string | null; inviteeEmail?: string | null }): ApproveResult {
  let outcome: ApproveResult | null = null;
  const tx = db.transaction(() => {
    const row = selectById.get(args.id) as InviteRequest | undefined;
    if (!row) { outcome = { ok: false, reason: 'not_found' }; return; }
    if (row.status !== 'pending') { outcome = { ok: false, reason: 'not_pending' }; return; }

    const inviteeEmail = (args.inviteeEmail ?? row.invitee_email ?? '').trim();
    if (!inviteeEmail) { outcome = { ok: false, reason: 'no_email' }; return; }

    const note = args.note ? args.note.trim().slice(0, 500) : null;
    const invitation = createInvitation({
      inviterId: row.requester_id,
      inviteeEmail,
      note,
      source: 'admin_grant',
      bypassQuota: true,
    });
    const r = markApprovedStmt.run(args.adminEmail, note, invitation.id, args.id);
    if (r.changes === 0) {
      outcome = { ok: false, reason: 'not_pending' };
      return;
    }
    outcome = { ok: true, invitation };
  });
  tx();
  return outcome!;
}

export type DenyResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'note_required' };

export function denyRequest(args: { id: number; adminEmail: string; note: string }): DenyResult {
  const note = (args.note ?? '').trim();
  if (!note) return { ok: false, reason: 'note_required' };

  let outcome: DenyResult | null = null;
  const tx = db.transaction(() => {
    const row = selectById.get(args.id) as InviteRequest | undefined;
    if (!row) { outcome = { ok: false, reason: 'not_found' }; return; }
    if (row.status !== 'pending') { outcome = { ok: false, reason: 'not_pending' }; return; }
    const r = markDeniedStmt.run(args.adminEmail, note.slice(0, 500), args.id);
    if (r.changes === 0) { outcome = { ok: false, reason: 'not_pending' }; return; }
    outcome = { ok: true };
  });
  tx();
  return outcome!;
}
