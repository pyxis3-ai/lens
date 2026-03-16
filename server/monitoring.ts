import { config } from './config'
import { k8s } from './k8s'
import { metrics } from './metrics'
import { security } from './security'
import { health } from './health'
import { nginx } from './nginx'
import { store } from './db'
import type { SystemMetrics } from './metrics'

// --- WebSocket broadcast ---

const WS_CLIENTS = new Set<any>()

export function addClient(ws: any) { WS_CLIENTS.add(ws) }
export function removeClient(ws: any) { WS_CLIENTS.delete(ws) }

function broadcast(type: string, data: any) {
  const msg = JSON.stringify({ type, data, ts: Date.now() })
  for (const ws of WS_CLIENTS) {
    try { ws.send(msg) } catch { WS_CLIENTS.delete(ws) }
  }
}

// --- Alert thresholds (configurable, persisted to SQLite) ---

interface Threshold { warn: number; crit: number }

const defaults: Record<string, Threshold> = {
  cpu: { warn: 75, crit: 90 },
  memory: { warn: 85, crit: 95 },
  disk: { warn: 80, crit: 95 },
  swap: { warn: 50, crit: 80 },
  load: { warn: 200, crit: 400 },
}

// Load from db, fall back to defaults
const thresholds: Record<string, Threshold> = { ...defaults }
const saved = store.getThresholds()
for (const [id, t] of Object.entries(saved)) thresholds[id] = t

export function getThresholds() { return { ...thresholds } }

export function updateThreshold(id: string, warn: number, crit: number): { ok: boolean } {
  if (!thresholds[id]) return { ok: false }
  thresholds[id] = { warn, crit }
  store.saveThreshold(id, warn, crit)
  return { ok: true }
}

// --- Alerts (rules + state + webhook + ack) ---

interface Alert {
  id: string
  level: 'warning' | 'critical'
  message: string
  ts: number
  resolved: boolean
  acknowledged: boolean
}

const activeAlerts = new Map<string, Alert>()
const alertHistory: Alert[] = []
const acknowledgedIds = new Set<string>()

function fire(id: string, level: 'warning' | 'critical', message: string) {
  if (activeAlerts.has(id)) return
  if (acknowledgedIds.has(id)) return // Don't re-fire acknowledged
  const alert: Alert = { id, level, message, ts: Date.now(), resolved: false, acknowledged: false }
  activeAlerts.set(id, alert)
  alertHistory.push(alert)
  if (alertHistory.length > config.alertHistoryMax) alertHistory.shift()

  console.log(`[ALERT ${level.toUpperCase()}] ${message}`)
  if (config.alertWebhook) sendWebhook(alert)
}

function resolve(id: string) {
  const alert = activeAlerts.get(id)
  if (alert) {
    alert.resolved = true
    activeAlerts.delete(id)
    acknowledgedIds.delete(id) // Clear ack when resolved
    alertHistory.push({ ...alert, ts: Date.now(), resolved: true })
    console.log(`[RESOLVED] ${alert.message}`)
  }
}

export function acknowledgeAlert(id: string): { ok: boolean } {
  const alert = activeAlerts.get(id)
  if (alert) {
    alert.acknowledged = true
    acknowledgedIds.add(id)
    broadcast('alerts', getActiveAlerts())
    return { ok: true }
  }
  return { ok: false }
}

export function dismissAlert(id: string): { ok: boolean } {
  const alert = activeAlerts.get(id)
  if (alert) {
    activeAlerts.delete(id)
    acknowledgedIds.add(id) // Prevent re-fire until condition clears
    alertHistory.push({ ...alert, ts: Date.now(), resolved: true })
    broadcast('alerts', getActiveAlerts())
    return { ok: true }
  }
  return { ok: false }
}

async function sendWebhook(alert: Alert) {
  try {
    await fetch(config.alertWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `**${alert.level === 'critical' ? '🔴' : '⚠️'} ${alert.level.toUpperCase()}**: ${alert.message}`,
      }),
      signal: AbortSignal.timeout(config.webhookTimeout),
    })
  } catch (e) {
    console.error('[alert] webhook failed:', (e as Error).message)
  }
}

function evaluateAlerts(system: SystemMetrics, pods: any[]) {
  if (!system) return

  const t = thresholds

  // CPU
  if (system.cpu.percent > t.cpu.crit) fire('cpu-crit', 'critical', `CPU at ${system.cpu.percent}%`)
  else if (system.cpu.percent > t.cpu.warn) fire('cpu-warn', 'warning', `CPU at ${system.cpu.percent}%`)
  else { resolve('cpu-crit'); resolve('cpu-warn') }

  // Memory
  if (system.memory.percent > t.memory.crit) fire('mem-crit', 'critical', `Memory at ${system.memory.percent}%`)
  else if (system.memory.percent > t.memory.warn) fire('mem-warn', 'warning', `Memory at ${system.memory.percent}%`)
  else { resolve('mem-crit'); resolve('mem-warn') }

  // Disk
  if (system.disk.percent > t.disk.crit) fire('disk-crit', 'critical', `Disk at ${system.disk.percent}%`)
  else if (system.disk.percent > t.disk.warn) fire('disk-warn', 'warning', `Disk at ${system.disk.percent}%`)
  else { resolve('disk-crit'); resolve('disk-warn') }

  // Load (as % of cores)
  const loadPct = system.cpu.cores > 0 ? (system.cpu.load15 / system.cpu.cores) * 100 : 0
  if (loadPct > t.load.crit) fire('load-crit', 'critical', `Load ${system.cpu.load15} (${loadPct.toFixed(0)}% of ${system.cpu.cores} cores)`)
  else if (loadPct > t.load.warn) fire('load-warn', 'warning', `Load ${system.cpu.load15} (${loadPct.toFixed(0)}% of ${system.cpu.cores} cores)`)
  else { resolve('load-crit'); resolve('load-warn') }

  // Swap
  if (system.swap.percent > t.swap.crit) fire('swap-crit', 'critical', `Swap at ${system.swap.percent}%`)
  else if (system.swap.percent > t.swap.warn) fire('swap-warn', 'warning', `Swap at ${system.swap.percent}%`)
  else { resolve('swap-crit'); resolve('swap-warn') }

  // Pod issues
  if (pods?.length) {
    const notReady = pods.filter((p: any) => p.status !== 'Running' || !p.ready)
    if (notReady.length) fire('pods-notready', 'warning', `${notReady.length} pods not ready: ${notReady.map((p: any) => p.name).slice(0, 3).join(', ')}`)
    else resolve('pods-notready')

    // OOMKilled: only alert if pod is NOT currently Running+Ready (i.e. still recovering)
    const oomPods = pods.filter((p: any) => p.lastTermination?.reason === 'OOMKilled' && !(p.status === 'Running' && p.ready))
    if (oomPods.length) fire('pods-oom', 'critical', `OOMKilled: ${oomPods.map((p: any) => p.name).slice(0, 3).join(', ')}`)
    else resolve('pods-oom')

    const crashLoop = pods.filter((p: any) => p.restarts > config.crashLoopThreshold)
    if (crashLoop.length) fire('pods-crash', 'warning', `Crash looping: ${crashLoop.map((p: any) => `${p.name}(${p.restarts})`).slice(0, 3).join(', ')}`)
    else resolve('pods-crash')

    // No resource limits
    const noLimits = pods.filter((p: any) => p.containers?.some((c: any) => !c.limits?.memory && !c.limits?.cpu))
    if (noLimits.length > config.noLimitsThreshold) fire('pods-nolimits', 'warning', `${noLimits.length} pods without resource limits`)
    else resolve('pods-nolimits')
  }
}

// --- Public alert accessors ---

export function getActiveAlerts(): Alert[] {
  return [...activeAlerts.values()]
}

export function getAlertHistory(limit = 50): Alert[] {
  return alertHistory.slice(-limit).reverse()
}

// --- Certificate expiry check ---

async function checkCertExpiry() {
  try {
    const certs = await k8s.certificates()
    for (const cert of certs) {
      if (!cert.notAfter) continue
      const daysLeft = Math.floor((new Date(cert.notAfter).getTime() - Date.now()) / 86400_000)
      if (daysLeft < config.certCritDays) fire(`cert-${cert.name}-crit`, 'critical', `Cert ${cert.name} expires in ${daysLeft}d`)
      else if (daysLeft < config.certWarnDays) fire(`cert-${cert.name}-warn`, 'warning', `Cert ${cert.name} expires in ${daysLeft}d`)
      else { resolve(`cert-${cert.name}-crit`); resolve(`cert-${cert.name}-warn`) }
    }
  } catch (e) { console.error('[monitoring] cert check error:', e) }
}

// --- Broadcast loops (self-scheduling setTimeout to avoid overlapping) ---

async function systemLoop() {
  try { broadcast('system', await metrics.system()) } catch (e) { console.error('[monitoring] system:', e) }
  setTimeout(systemLoop, config.systemInterval)
}
systemLoop()

async function podsLoop() {
  try {
    const [pods, sec, sys] = await Promise.all([k8s.pods(), security.summary(), metrics.system()])
    broadcast('pods', pods)
    broadcast('security', sec)
    evaluateAlerts(sys, pods)
    broadcast('alerts', getActiveAlerts())
  } catch (e) { console.error('[monitoring] pods:', e) }
  setTimeout(podsLoop, config.podsInterval)
}
podsLoop()

// Check cert expiry every 5 minutes
checkCertExpiry()
setTimeout(function certLoop() {
  checkCertExpiry().finally(() => setTimeout(certLoop, config.certCheckInterval))
}, config.certCheckInterval)

async function healthLoop() {
  try {
    const [h, n] = await Promise.all([health.check(), nginx.analyze(300)])
    broadcast('health', h)
    broadcast('nginx', n)
  } catch (e) { console.error('[monitoring] health:', e) }
  setTimeout(healthLoop, config.healthInterval)
}
healthLoop()

let lastAttackTs = 0
async function attackLoop() {
  try {
    const data = await security.nginxAttacks(50)
    const newAttacks = data.attacks.filter((a: any) => {
      if (!a?.time) return false
      const ts = new Date(a.time).getTime()
      return !isNaN(ts) && ts > lastAttackTs
    })
    for (const a of newAttacks) store.saveAttack(a)
    if (newAttacks.length) {
      const maxTs = Math.max(...newAttacks.map((a: any) => new Date(a.time).getTime()))
      lastAttackTs = maxTs
    }
  } catch (e) { console.error('[monitoring] attacks:', e) }
  setTimeout(attackLoop, config.attackStoreInterval)
}
attackLoop()
