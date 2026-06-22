import { config } from './config'
import { k8s } from './k8s'
import { metrics } from './metrics'
import { security } from './security'
import { health } from './health'
import { nginx } from './nginx'
import { store } from './db'
import type { SystemMetrics, Alert } from '../src/lib/types'

const WS_CLIENTS = new Set<any>()

export function addClient(ws: any) { WS_CLIENTS.add(ws) }
export function removeClient(ws: any) { WS_CLIENTS.delete(ws) }

function broadcast(type: string, data: any) {
  const msg = JSON.stringify({ type, data, ts: Date.now() })
  for (const ws of WS_CLIENTS) {
    try { ws.send(msg) } catch { WS_CLIENTS.delete(ws) }
  }
}

interface Threshold { warn: number; crit: number }

const thresholds: Record<string, Threshold> = {
  cpu: { warn: 75, crit: 90 },
  memory: { warn: 85, crit: 95 },
  disk: { warn: 80, crit: 95 },
  swap: { warn: 50, crit: 80 },
  load: { warn: 200, crit: 400 },
}
for (const [id, t] of Object.entries(store.getThresholds())) thresholds[id] = t

export function getThresholds() { return { ...thresholds } }

export function updateThreshold(id: string, warn: number, crit: number): { ok: boolean } {
  if (!thresholds[id]) return { ok: false }
  thresholds[id] = { warn, crit }
  store.saveThreshold(id, warn, crit)
  return { ok: true }
}

const activeAlerts = new Map<string, Alert>()
const acknowledgedIds = new Set<string>()

function fire(id: string, level: 'warning' | 'critical', message: string) {
  if (activeAlerts.has(id) || acknowledgedIds.has(id)) return
  activeAlerts.set(id, { id, level, message, ts: Date.now(), resolved: false, acknowledged: false })
  console.log(`[ALERT ${level.toUpperCase()}] ${message}`)
  if (config.alertWebhook) sendWebhook(level, message)
}

function resolve(id: string) {
  if (activeAlerts.delete(id)) acknowledgedIds.delete(id)
}

export function acknowledgeAlert(id: string): { ok: boolean } {
  const alert = activeAlerts.get(id)
  if (!alert) return { ok: false }
  alert.acknowledged = true
  acknowledgedIds.add(id)
  broadcast('alerts', getActiveAlerts())
  return { ok: true }
}

export function dismissAlert(id: string): { ok: boolean } {
  if (!activeAlerts.delete(id)) return { ok: false }
  acknowledgedIds.add(id)
  broadcast('alerts', getActiveAlerts())
  return { ok: true }
}

async function sendWebhook(level: 'warning' | 'critical', message: string) {
  try {
    await fetch(config.alertWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: `**${level === 'critical' ? '🔴' : '⚠️'} ${level.toUpperCase()}**: ${message}` }),
      signal: AbortSignal.timeout(config.webhookTimeout),
    })
  } catch (e) {
    console.error('[alert] webhook failed:', (e as Error).message)
  }
}

function levelCheck(prefix: string, value: number, th: Threshold, msg: string) {
  if (value > th.crit) fire(`${prefix}-crit`, 'critical', msg)
  else if (value > th.warn) fire(`${prefix}-warn`, 'warning', msg)
  else { resolve(`${prefix}-crit`); resolve(`${prefix}-warn`) }
}

function evaluateAlerts(system: SystemMetrics, pods: any[]) {
  if (!system) return

  const t = thresholds
  const loadPct = system.cpu.cores > 0 ? (system.cpu.load15 / system.cpu.cores) * 100 : 0

  levelCheck('cpu', system.cpu.percent, t.cpu, `CPU at ${system.cpu.percent}%`)
  levelCheck('mem', system.memory.percent, t.memory, `Memory at ${system.memory.percent}%`)
  levelCheck('disk', system.disk.percent, t.disk, `Disk at ${system.disk.percent}%`)
  levelCheck('load', loadPct, t.load, `Load ${system.cpu.load15} (${loadPct.toFixed(0)}% of ${system.cpu.cores} cores)`)
  levelCheck('swap', system.swap.percent, t.swap, `Swap at ${system.swap.percent}%`)

  if (!pods?.length) return

  const names = (list: any[]) => list.map(p => p.name).slice(0, 3).join(', ')
  const notReady = pods.filter(p => p.status !== 'Running' || !p.ready)
  if (notReady.length) fire('pods-notready', 'warning', `${notReady.length} pods not ready: ${names(notReady)}`)
  else resolve('pods-notready')

  const oomPods = pods.filter(p => p.lastTermination?.reason === 'OOMKilled' && !(p.status === 'Running' && p.ready))
  if (oomPods.length) fire('pods-oom', 'critical', `OOMKilled: ${names(oomPods)}`)
  else resolve('pods-oom')

  const crashLoop = pods.filter(p => p.restarts > config.crashLoopThreshold)
  if (crashLoop.length) fire('pods-crash', 'warning', `Crash looping: ${crashLoop.map(p => `${p.name}(${p.restarts})`).slice(0, 3).join(', ')}`)
  else resolve('pods-crash')

  const noLimits = pods.filter(p => p.containers?.some((c: any) => !c.limits?.memory && !c.limits?.cpu))
  if (noLimits.length > config.noLimitsThreshold) fire('pods-nolimits', 'warning', `${noLimits.length} pods without resource limits`)
  else resolve('pods-nolimits')
}

function getActiveAlerts(): Alert[] {
  return [...activeAlerts.values()]
}

async function checkCertExpiry() {
  for (const cert of await k8s.certificates()) {
    if (!cert.notAfter) continue
    const daysLeft = Math.floor((new Date(cert.notAfter).getTime() - Date.now()) / 86400_000)
    if (daysLeft < config.certCritDays) fire(`cert-${cert.name}-crit`, 'critical', `Cert ${cert.name} expires in ${daysLeft}d`)
    else if (daysLeft < config.certWarnDays) fire(`cert-${cert.name}-warn`, 'warning', `Cert ${cert.name} expires in ${daysLeft}d`)
    else { resolve(`cert-${cert.name}-crit`); resolve(`cert-${cert.name}-warn`) }
  }
}

function loop(interval: number, fn: () => Promise<unknown>, label: string) {
  const tick = () => fn().catch(e => console.error(`[monitoring] ${label}:`, e)).finally(() => setTimeout(tick, interval))
  tick()
}

let lastAttackTs = 0

export function startMonitoring() {
  loop(config.systemInterval, async () => broadcast('system', await metrics.system()), 'system')

  loop(config.podsInterval, async () => {
    const [pods, sec, sys] = await Promise.all([k8s.pods(), security.summary(), metrics.system()])
    broadcast('pods', pods)
    broadcast('security', sec)
    evaluateAlerts(sys, pods)
    broadcast('alerts', getActiveAlerts())
  }, 'pods')

  loop(config.healthInterval, async () => {
    const [h, n] = await Promise.all([health.check(), nginx.analyze()])
    broadcast('health', h)
    broadcast('nginx', n)
  }, 'health')

  loop(config.attackStoreInterval, async () => {
    const { attacks } = await nginx.attacks(50)
    const fresh = attacks.filter(a => {
      const ts = new Date(a.time).getTime()
      return !isNaN(ts) && ts > lastAttackTs
    })
    for (const a of fresh) store.saveAttack(a)
    if (fresh.length) lastAttackTs = Math.max(...fresh.map(a => new Date(a.time).getTime()))
  }, 'attacks')

  loop(config.certCheckInterval, checkCertExpiry, 'cert')
}
