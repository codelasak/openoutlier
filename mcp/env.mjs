// OpenOutlier – where the library lives and which settings apply.
//
// OpenOutlier used to be called ReelScope. New installs use ~/.openoutlier,
// openoutlier.db and OPENOUTLIER_* variables; an install that still has only
// the old names keeps working until it is moved (see README → "Moving from
// ReelScope").
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** OPENOUTLIER_<name>, falling back to the former REELSCOPE_<name>. */
export function setting(name) {
  const v = process.env['OPENOUTLIER_' + name];
  return v !== undefined && v !== '' ? v : process.env['REELSCOPE_' + name];
}

/** The data folder: OPENOUTLIER_HOME, else ~/.openoutlier, else a not-yet-moved ~/.reelscope. */
export function resolveHome() {
  const explicit = setting('HOME');
  if (explicit) return explicit;
  const current = join(homedir(), '.openoutlier');
  const former = join(homedir(), '.reelscope');
  return !existsSync(current) && existsSync(former) ? former : current;
}

export const DB_NAME = 'openoutlier.db';
export const FORMER_DB_NAME = 'reelscope.db';

/** The database file in `home`: openoutlier.db, unless only the former reelscope.db is there. */
export function dbFile(home) {
  const current = join(home, DB_NAME);
  const former = join(home, FORMER_DB_NAME);
  return !existsSync(current) && existsSync(former) ? former : current;
}
