import { Database } from 'bun:sqlite'
import { config } from './config'

interface ThresholdRow { id: string; warn: number; crit: number }
interface CountRow { c: number }

const db = new Database(config.dbPath, { create: true })

db.exec(`
  CREATE TABLE IF NOT EXISTS attacks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL, ip TEXT, uri TEXT
  );
  CREATE TABLE IF NOT EXISTS alert_thresholds (
    id TEXT PRIMARY KEY,
    warn REAL NOT NULL,
    crit REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attacks_ts ON attacks(ts);
`)

setInterval(() => {
  const cutoff = Math.floor((Date.now() - config.attackRetentionDays * 86400_000) / 1000)
  db.run('DELETE FROM attacks WHERE ts < ?', [cutoff])
}, config.cleanupInterval)

export const store = {
  saveAttack(a: { ip: string; uri: string }) {
    db.run('INSERT INTO attacks (ts, ip, uri) VALUES (?, ?, ?)', [Math.floor(Date.now() / 1000), a.ip, a.uri])
  },

  getThresholds(): Record<string, { warn: number; crit: number }> {
    const rows = db.query('SELECT id, warn, crit FROM alert_thresholds').all() as ThresholdRow[]
    const result: Record<string, { warn: number; crit: number }> = {}
    for (const r of rows) result[r.id] = { warn: r.warn, crit: r.crit }
    return result
  },

  saveThreshold(id: string, warn: number, crit: number) {
    db.run('INSERT OR REPLACE INTO alert_thresholds (id, warn, crit) VALUES (?, ?, ?)', [id, warn, crit])
  },

  getAttackStats() {
    const now = Math.floor(Date.now() / 1000)
    return {
      last1h: (db.query('SELECT COUNT(*) as c FROM attacks WHERE ts > ?').get(now - 3600) as CountRow | null)?.c || 0,
      last24h: (db.query('SELECT COUNT(*) as c FROM attacks WHERE ts > ?').get(now - 86400) as CountRow | null)?.c || 0,
      topIPs: db.query('SELECT ip, COUNT(*) as c FROM attacks WHERE ts > ? GROUP BY ip ORDER BY c DESC LIMIT 10').all(now - 86400),
      topPaths: db.query('SELECT uri, COUNT(*) as c FROM attacks WHERE ts > ? GROUP BY uri ORDER BY c DESC LIMIT 10').all(now - 86400),
    }
  },
}
