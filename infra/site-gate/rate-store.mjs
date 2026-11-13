import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { dirname } from 'node:path';

const IP_WINDOW_MS = 15 * 60 * 1000;
const ZONE_WINDOW_MS = 60 * 60 * 1000;
const MAX_IP_FAILURES = 5;
const MAX_ZONE_FAILURES = 10;

/** A dedicated pre-initialized SQLite database, never an application database. */
export function openRateStore(path, zone, pepper, now = Date.now) {
  if (!['production', 'test'].includes(zone) || pepper.length !== 32) throw new Error('Invalid rate-store configuration');
  const parent = lstatSync(dirname(path));
  const initial = lstatSync(path);
  const uid = process.getuid();
  if (!parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o777) !== 0o700 ||
      !initial.isFile() || initial.uid !== uid || (initial.mode & 0o777) !== 0o600 || initial.size < 1 || initial.size > 1024 * 1024) {
    throw new Error('Unprotected rate-store path');
  }
  process.umask(0o077);
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA busy_timeout=3000; PRAGMA trusted_schema=OFF; PRAGMA synchronous=FULL; PRAGMA max_page_count=64;');
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok' ||
        db.prepare('PRAGMA user_version').get().user_version !== 1 ||
        db.prepare('SELECT zone FROM maintenance_meta').get()?.zone !== zone ||
        db.prepare('SELECT count(*) AS n FROM maintenance_meta').get().n !== 1) {
      throw new Error('Invalid rate-store identity');
    }
    const identity = { dev: initial.dev, ino: initial.ino };
    function check() {
      const current = lstatSync(path);
      if (!current.isFile() || current.uid !== uid || (current.mode & 0o777) !== 0o600 ||
          current.dev !== identity.dev || current.ino !== identity.ino ||
          db.prepare('SELECT zone FROM maintenance_meta').get()?.zone !== zone) {
        throw new Error('Rate-store changed or unavailable');
      }
    }
    function attempt(ip, verify) {
      check();
      if (typeof ip !== 'string' || !ip || ip.length > 128) throw new Error('Invalid client address');
      const time = now();
      if (!Number.isSafeInteger(time) || time < 0) throw new Error('Invalid clock');
      const client = createHmac('sha256', pepper).update(`rate-ip:${ip}`).digest('hex');
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM failures WHERE occurred <= ?').run(time - ZONE_WINDOW_MS);
        const total = db.prepare('SELECT count(*) AS n FROM failures WHERE occurred > ?').get(time - ZONE_WINDOW_MS).n;
        const perIp = db.prepare('SELECT count(*) AS n FROM failures WHERE client = ? AND occurred > ?').get(client, time - IP_WINDOW_MS).n;
        if (total >= MAX_ZONE_FAILURES || perIp >= MAX_IP_FAILURES) {
          db.exec('COMMIT');
          return 'blocked';
        }
        const correct = verify();
        if (!correct) db.prepare('INSERT INTO failures (occurred, client) VALUES (?, ?)').run(time, client);
        db.exec('COMMIT');
        return correct ? 'accepted' : 'rejected';
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch { /* retain original failure */ }
        throw error;
      }
    }
    return { check, attempt, close: () => db.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}
