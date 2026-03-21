export interface SystemMetrics {
  cpu: { percent: number; cores: number; perCore: number[]; load1: number; load5: number; load15: number }
  memory: { total: number; used: number; available: number; percent: number; buffers: number; cached: number }
  swap: { total: number; used: number; percent: number }
  disk: { total: number; used: number; free: number; percent: number }
  network: { rxBytes: number; txBytes: number; rxRate: number; txRate: number; connections: number }
  uptime: number
  processes: number
}

export interface ContainerInfo {
  name: string; ready: boolean; restarts: number; state: string
  cpu: number | null; memory: number | null
  requests: { cpu: string | null; memory: number | null }
  limits: { cpu: string | null; memory: number | null }
  image: string
}

export interface Pod {
  namespace: string; name: string; status: string; ready: boolean
  readyCount: number; totalCount: number
  restarts: number; containers: ContainerInfo[]; age: string; node: string
  ip: string; qos: string
  cpu: string | null; memory: number | null; metricsAvailable: boolean
  lastTermination: { reason: string; exitCode: number; time: string } | null
  ownerKind: string; ownerName: string
}

export interface Node {
  name: string; status: string; roles: string[]
  cpu: number | null; memory: number | null
  allocatable: { cpu: number; memory: number; pods: number }
  capacity: { cpu: number; memory: number }
  age: string; version: string; os: string; arch: string; containerRuntime: string
  conditions: string[]
}

export interface Fail2banJail { banned: number; totalBanned: number; bannedIPs: string[]; probes: number; uniqueProbeIPs: number; probeIPs: string[] }
export interface SecuritySummary { fail2ban: Record<string, Fail2banJail>; totalBanned: number; totalProbes: number }
export interface NginxAttack { time: string; ip: string; method: string; uri: string; status: number; host: string; ua: string }
export interface ServiceHealth { name: string; host: string; namespace: string; status: number; ok: boolean; latency: number; error?: string }
export interface K8sEvent { namespace: string; type: string; reason: string; message: string; object: string; time: string; count: number }
export interface Certificate { name: string; namespace: string; ready: boolean; notAfter: string; renewalTime: string; dnsNames: string[] }
export interface Alert { id: string; level: 'warning' | 'critical'; message: string; ts: number; resolved: boolean; acknowledged: boolean }

export interface NginxStats {
  requestsTotal: number
  totalBytes: number
  byStatus: Record<string, number>
  byHost: Record<string, number>
  topIPs: { ip: string; count: number }[]
  topPaths: { uri: string; count: number }[]
  topUAs: { ua: string; count: number }[]
  avgResponseTime: number
  avgUpstreamTime: number
  wafBlocks: number
  tlsVersions: Record<string, number>
}

export interface AlertThresholds {
  [key: string]: { warn: number; crit: number }
}
