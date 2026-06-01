// Tiny helper for the admin audit log. Every admin write should call this.
import { db } from '../db/index.js';

const insert = db.prepare(`
  INSERT INTO admin_audit_log (email, action, target, payload, ip)
  VALUES (?, ?, ?, ?, ?)
`);

export function audit(email: string, action: string, target: string | null, payload: object | null, ip: string | null): void {
  insert.run(email, action, target, payload ? JSON.stringify(payload) : null, ip);
}
