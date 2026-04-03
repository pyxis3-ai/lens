import { ref } from 'vue'
import type { SystemMetrics, Pod, SecuritySummary, ServiceHealth, NginxStats, Alert, NginxAttack, K8sEvent, Certificate, Node, AlertThresholds } from './types'

export const system = ref<SystemMetrics | null>(null)
export const pods = ref<Pod[]>([])
export const security = ref<SecuritySummary | null>(null)
export const services = ref<ServiceHealth[]>([])
export const nginxStats = ref<NginxStats | null>(null)
export const activeAlerts = ref<Alert[]>([])
export const connected = ref(false)

// REST-hydrated data
export const attacks = ref<NginxAttack[]>([])
export const attackStats = ref<{ last1h: number; last24h: number; topIPs: { ip: string; c: number }[]; topPaths: { uri: string; c: number }[] } | null>(null)
export const events = ref<K8sEvent[]>([])
export const certificates = ref<Certificate[]>([])
export const deployments = ref<any[]>([])
export const statefulsets = ref<any[]>([])
export const pvcs = ref<any[]>([])
export const ingresses = ref<any[]>([])
export const k8sServices = ref<any[]>([])
export const daemonsets = ref<any[]>([])
export const replicasets = ref<any[]>([])
export const cronjobs = ref<any[]>([])
export const jobs = ref<any[]>([])
export const configmaps = ref<any[]>([])
export const secrets = ref<any[]>([])
export const sshAttacks = ref<{ total: number; invalidUsers: number; failedPasswords: number; probes: number; recent: { time: string; ip: string; user: string; type: string }[]; topIPs: [string, number][]; topUsers: [string, number][] } | null>(null)
export const autheliaStats = ref<{ requests: number; blocked: number; byHost: Record<string, number>; recent: { time: string; host: string; user: string; status: number; method: string }[] } | null>(null)
export const namespaceFilter = ref<string>('')
export const nodes = ref<Node[]>([])
export const alertThresholds = ref<AlertThresholds>({})

let ws: WebSocket | null = null

export function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  ws = new WebSocket(`${proto}//${location.host}/ws`)
  ws.onopen = () => { connected.value = true }
  ws.onclose = () => { connected.value = false; setTimeout(connect, 2000) }
  ws.onerror = () => ws?.close()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type === 'system') system.value = msg.data
    if (msg.type === 'pods') pods.value = msg.data
    if (msg.type === 'security') security.value = msg.data
    if (msg.type === 'health') services.value = msg.data
    if (msg.type === 'nginx') nginxStats.value = msg.data
    if (msg.type === 'alerts') activeAlerts.value = msg.data
  }
}

async function fetchJson(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

export async function loadSSH() {
  try { sshAttacks.value = await fetchJson('/api/security/ssh') } catch (e) { console.error('[ws] loadSSH failed:', e) }
}

export async function loadAuthelia() {
  try { autheliaStats.value = await fetchJson('/api/security/authelia') } catch (e) { console.error('[ws] loadAuthelia failed:', e) }
}

export async function loadAttacks() {
  try {
    const [aRes, sRes] = await Promise.all([
      fetchJson('/api/security/nginx?lines=100'),
      fetchJson('/api/security/stats'),
    ])
    attacks.value = aRes.attacks || []
    attackStats.value = sRes
  } catch (e) { console.error('[ws] loadAttacks failed:', e) }
}

export async function loadEvents() {
  try {
    const [ev, cert] = await Promise.all([
      fetchJson('/api/events?limit=200'),
      fetchJson('/api/certificates'),
    ])
    events.value = ev
    certificates.value = cert
  } catch (e) { console.error('[ws] loadEvents failed:', e) }
}

export async function loadResources() {
  try {
    const [d, s, p, i, n, svc, ds, rs, cj, j, cm, sec] = await Promise.all([
      fetchJson('/api/deployments'),
      fetchJson('/api/statefulsets'),
      fetchJson('/api/pvcs'),
      fetchJson('/api/ingresses'),
      fetchJson('/api/nodes'),
      fetchJson('/api/services'),
      fetchJson('/api/daemonsets'),
      fetchJson('/api/replicasets'),
      fetchJson('/api/cronjobs'),
      fetchJson('/api/jobs'),
      fetchJson('/api/configmaps'),
      fetchJson('/api/secrets'),
    ])
    deployments.value = d
    statefulsets.value = s
    pvcs.value = p
    ingresses.value = i
    nodes.value = n
    k8sServices.value = svc
    daemonsets.value = ds
    replicasets.value = rs
    cronjobs.value = cj
    jobs.value = j
    configmaps.value = cm
    secrets.value = sec
  } catch (e) { console.error('[ws] loadResources failed:', e) }
}

export async function loadThresholds() {
  try { alertThresholds.value = await fetchJson('/api/alerts/thresholds') } catch (e) { console.error('[ws] loadThresholds failed:', e) }
}

export async function ackAlert(id: string) {
  try {
    await fetch('/api/alerts/ack', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  } catch (e) { console.error('[ws] ackAlert failed:', e) }
}

export async function dismissAlert(id: string) {
  try {
    await fetch('/api/alerts/dismiss', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
  } catch (e) { console.error('[ws] dismissAlert failed:', e) }
}

export async function saveThreshold(id: string, warn: number, crit: number) {
  try {
    await fetch('/api/alerts/thresholds', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, warn, crit }) })
    await loadThresholds()
  } catch (e) { console.error('[ws] saveThreshold failed:', e) }
}
