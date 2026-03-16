import { readFile } from 'fs/promises'
import { config } from './config'

const API = config.k8sApi
const TOKEN_PATH = config.k8sTokenPath

let _token = ''
let _tokenTime = 0

export async function k8sGetToken(): Promise<string> {
  if (_token && Date.now() - _tokenTime < config.tokenCacheTTL) return _token
  try {
    _token = (await readFile(TOKEN_PATH, 'utf-8')).trim()
    _tokenTime = Date.now()
  } catch (e) {
    console.error('[k8s] Failed to read SA token:', (e as Error).message)
    _token = ''
  }
  return _token
}

export async function k8sGet(path: string): Promise<any> {
  const t = await k8sGetToken()
  if (!t) return null
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${t}` },
      // @ts-ignore
      tls: { rejectUnauthorized: false },
    })
    if (!res.ok) {
      console.error(`[k8s] ${path} → ${res.status}`)
      return null
    }
    return res.json()
  } catch (e) {
    console.error(`[k8s] ${path} error:`, (e as Error).message)
    return null
  }
}

async function k8sWrite(method: string, path: string, body?: any): Promise<{ ok: boolean; status: number; data: any }> {
  const t = await k8sGetToken()
  if (!t) return { ok: false, status: 401, data: { error: 'No token' } }
  try {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, 'Content-Type': method === 'PATCH' ? 'application/strategic-merge-patch+json' : 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      // @ts-ignore
      tls: { rejectUnauthorized: false },
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) console.error(`[k8s] ${method} ${path} → ${res.status}`, data.message || '')
    return { ok: res.ok, status: res.status, data }
  } catch (e) {
    return { ok: false, status: 0, data: { error: (e as Error).message } }
  }
}

function parseCpu(v: string): number {
  if (!v) return 0
  if (v.endsWith('n')) return parseInt(v) / 1e6
  if (v.endsWith('m')) return parseFloat(v)
  return parseFloat(v) * 1000
}

function parseMem(v: string): number {
  if (!v) return 0
  if (v.endsWith('Ki')) return parseInt(v) * 1024
  if (v.endsWith('Mi')) return parseInt(v) * 1048576
  if (v.endsWith('Gi')) return parseInt(v) * 1073741824
  return parseInt(v)
}

export const k8s = {
  // --- Read operations ---

  async pods() {
    const [podData, topData] = await Promise.all([
      k8sGet('/api/v1/pods'),
      k8sGet('/apis/metrics.k8s.io/v1beta1/pods'),
    ])
    if (!podData?.items) return []

    const metricsAvailable = !!topData?.items

    // Build per-container metrics map: ns/pod/container → {cpu, memory}
    const containerMetrics: Record<string, { cpu: number; memory: number }> = {}
    const podMetrics: Record<string, { cpu: number; memory: number }> = {}
    for (const t of topData?.items || []) {
      const podKey = `${t.metadata.namespace}/${t.metadata.name}`
      let podCpu = 0, podMem = 0
      for (const c of t.containers || []) {
        const cpu = parseCpu(c.usage?.cpu)
        const mem = parseMem(c.usage?.memory)
        containerMetrics[`${podKey}/${c.name}`] = { cpu, memory: mem }
        podCpu += cpu
        podMem += mem
      }
      podMetrics[podKey] = { cpu: podCpu, memory: podMem }
    }

    return podData.items.map((p: any) => {
      const podKey = `${p.metadata.namespace}/${p.metadata.name}`
      const top = podMetrics[podKey]
      const term = p.status.containerStatuses?.find((c: any) => c.lastState?.terminated)?.lastState?.terminated

      // Container-level detail: metrics + requests/limits from spec
      const containers = (p.spec.containers || []).map((c: any) => {
        const cStatus = p.status.containerStatuses?.find((s: any) => s.name === c.name)
        const cMetrics = containerMetrics[`${podKey}/${c.name}`]
        return {
          name: c.name,
          ready: cStatus?.ready ?? false,
          restarts: cStatus?.restartCount || 0,
          state: cStatus?.state ? Object.keys(cStatus.state)[0] : 'unknown',
          // Actual usage from metrics-server (null if unavailable)
          cpu: cMetrics ? cMetrics.cpu : null,
          memory: cMetrics ? cMetrics.memory : null,
          // Requests/limits from pod spec (always available — graceful degradation)
          requests: {
            cpu: c.resources?.requests?.cpu || null,
            memory: c.resources?.requests?.memory ? parseMem(c.resources.requests.memory) : null,
          },
          limits: {
            cpu: c.resources?.limits?.cpu || null,
            memory: c.resources?.limits?.memory ? parseMem(c.resources.limits.memory) : null,
          },
          image: c.image,
        }
      })

      const statuses = p.status.containerStatuses || []
      const readyCount = statuses.filter((c: any) => c.ready).length
      const totalCount = (p.spec.containers || []).length

      return {
        namespace: p.metadata.namespace,
        name: p.metadata.name,
        status: p.status.phase,
        ready: readyCount === totalCount && totalCount > 0,
        readyCount,
        totalCount,
        restarts: statuses.reduce((s: number, c: any) => s + (c.restartCount || 0), 0),
        containers,
        age: p.metadata.creationTimestamp,
        node: p.spec.nodeName,
        ip: p.status.podIP || '',
        qos: p.status.qosClass || '',
        cpu: top ? `${top.cpu.toFixed(1)}m` : (metricsAvailable ? '0m' : null),
        memory: top?.memory || (metricsAvailable ? 0 : null),
        metricsAvailable,
        lastTermination: term ? { reason: term.reason, exitCode: term.exitCode, time: term.finishedAt } : null,
        ownerKind: p.metadata.ownerReferences?.[0]?.kind || '',
        ownerName: p.metadata.ownerReferences?.[0]?.name || '',
      }
    })
  },

  async podLogs(namespace: string, pod: string, container?: string | number, tail = 200) {
    const t = await k8sGetToken()
    if (!t || !namespace || !pod) return []

    if (typeof container === 'number') {
      tail = container
      container = undefined
    }

    if (container) {
      const res = await fetch(
        `${API}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?tailLines=${tail}&container=${encodeURIComponent(container)}`,
        { headers: { Authorization: `Bearer ${t}` }, tls: { rejectUnauthorized: false } as any }
      )
      return res.ok ? (await res.text()).split('\n').filter(Boolean) : [`Error: ${res.status}`]
    }

    const podInfo = await k8sGet(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}`)
    if (!podInfo?.spec?.containers) return ['Error: pod not found']

    const logs: string[] = []
    const containers = podInfo.spec.containers.map((c: any) => c.name)

    for (const cname of containers) {
      const res = await fetch(
        `${API}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?tailLines=${tail}&container=${encodeURIComponent(cname)}`,
        { headers: { Authorization: `Bearer ${t}` }, tls: { rejectUnauthorized: false } as any }
      )
      if (containers.length > 1) logs.push(`─── ${cname} ───`)
      if (res.ok) logs.push(...(await res.text()).split('\n').filter(Boolean))
      else logs.push(`Error: ${res.status}`)
    }
    return logs
  },

  async podsByLabel(namespace: string, label: string): Promise<string[]> {
    const data = await k8sGet(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${encodeURIComponent(label)}`)
    return data?.items?.map((p: any) => p.metadata.name) || []
  },

  async namespaces() {
    const data = await k8sGet('/api/v1/namespaces')
    return data?.items?.map((n: any) => ({ name: n.metadata.name, status: n.status.phase, age: n.metadata.creationTimestamp })) || []
  },

  async nodes() {
    const [nodeData, topData] = await Promise.all([
      k8sGet('/api/v1/nodes'),
      k8sGet('/apis/metrics.k8s.io/v1beta1/nodes'),
    ])
    if (!nodeData?.items) return []

    const topMap: Record<string, { cpu: number; memory: number }> = {}
    for (const t of topData?.items || []) {
      topMap[t.metadata.name] = {
        cpu: parseCpu(t.usage?.cpu),
        memory: parseMem(t.usage?.memory),
      }
    }

    return nodeData.items.map((n: any) => {
      const top = topMap[n.metadata.name]
      const conditions = n.status.conditions || []
      const ready = conditions.find((c: any) => c.type === 'Ready')?.status === 'True'
      return {
        name: n.metadata.name,
        status: ready ? 'Ready' : 'NotReady',
        roles: Object.keys(n.metadata.labels || {}).filter(l => l.startsWith('node-role.kubernetes.io/')).map(l => l.split('/')[1]),
        cpu: top ? top.cpu : null,
        memory: top ? top.memory : null,
        allocatable: {
          cpu: parseCpu(n.status.allocatable?.cpu || '0'),
          memory: parseMem(n.status.allocatable?.memory || '0'),
          pods: parseInt(n.status.allocatable?.pods || '0'),
        },
        capacity: {
          cpu: parseCpu(n.status.capacity?.cpu || '0'),
          memory: parseMem(n.status.capacity?.memory || '0'),
        },
        age: n.metadata.creationTimestamp,
        version: n.status.nodeInfo?.kubeletVersion,
        os: n.status.nodeInfo?.osImage,
        arch: n.status.nodeInfo?.architecture,
        containerRuntime: n.status.nodeInfo?.containerRuntimeVersion,
        conditions: conditions
          .filter((c: any) => {
            // Show problems: pressure/unavailable conditions that are True
            if (['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'].includes(c.type)) return c.status === 'True'
            // Hide: Ready (shown via status), and healthy informational conditions
            return false
          })
          .map((c: any) => c.type),
      }
    })
  },

  async events(limit = 50) {
    const data = await k8sGet(`/api/v1/events?limit=${limit}`)
    if (!data?.items) return []
    return data.items
      .sort((a: any, b: any) => new Date(b.lastTimestamp || b.metadata.creationTimestamp || 0).getTime() - new Date(a.lastTimestamp || a.metadata.creationTimestamp || 0).getTime())
      .slice(0, limit)
      .map((e: any) => ({
        namespace: e.metadata.namespace, type: e.type, reason: e.reason, message: e.message,
        object: `${e.involvedObject?.kind}/${e.involvedObject?.name}`,
        time: e.lastTimestamp || e.metadata.creationTimestamp, count: e.count || 1,
      }))
  },

  async certificates() {
    const data = await k8sGet('/apis/cert-manager.io/v1/certificates')
    return data?.items?.map((c: any) => ({
      name: c.metadata.name, namespace: c.metadata.namespace,
      ready: c.status?.conditions?.find((x: any) => x.type === 'Ready')?.status === 'True',
      notAfter: c.status?.notAfter, renewalTime: c.status?.renewalTime, dnsNames: c.spec?.dnsNames,
    })) || []
  },

  async ingresses() {
    const data = await k8sGet('/apis/networking.k8s.io/v1/ingresses')
    return data?.items?.map((i: any) => ({
      name: i.metadata.name, namespace: i.metadata.namespace,
      class: i.spec?.ingressClassName || i.metadata.annotations?.['kubernetes.io/ingress.class'] || '',
      hosts: i.spec?.rules?.map((r: any) => r.host).filter(Boolean) || [],
      address: i.status?.loadBalancer?.ingress?.[0]?.ip || '',
      tls: !!i.spec?.tls?.length,
      age: i.metadata.creationTimestamp,
    })) || []
  },

  async pvcs() {
    const data = await k8sGet('/api/v1/persistentvolumeclaims')
    return data?.items?.map((p: any) => ({
      namespace: p.metadata.namespace, name: p.metadata.name, status: p.status.phase,
      volume: p.spec.volumeName || '',
      capacity: p.status.capacity?.storage || p.spec.resources?.requests?.storage || '?',
      storageClass: p.spec.storageClassName, accessModes: p.spec.accessModes,
      age: p.metadata.creationTimestamp,
    })) || []
  },

  async services() {
    const data = await k8sGet('/api/v1/services')
    return data?.items?.map((s: any) => ({
      namespace: s.metadata.namespace, name: s.metadata.name,
      type: s.spec.type,
      clusterIP: s.spec.clusterIP,
      externalIP: s.status?.loadBalancer?.ingress?.[0]?.ip || s.spec.externalIPs?.[0] || '',
      ports: (s.spec.ports || []).map((p: any) => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol}`).join(', '),
      age: s.metadata.creationTimestamp,
    })) || []
  },

  async deployments() {
    const data = await k8sGet('/apis/apps/v1/deployments')
    return data?.items?.map((d: any) => ({
      namespace: d.metadata.namespace, name: d.metadata.name, replicas: d.spec.replicas,
      ready: d.status.readyReplicas || 0,
      upToDate: d.status.updatedReplicas || 0,
      available: d.status.availableReplicas || 0,
      age: d.metadata.creationTimestamp,
      image: d.spec.template.spec.containers?.[0]?.image || '',
      conditions: (d.status.conditions || []).map((c: any) => ({ type: c.type, status: c.status })),
    })) || []
  },

  async statefulsets() {
    const data = await k8sGet('/apis/apps/v1/statefulsets')
    return data?.items?.map((s: any) => ({
      namespace: s.metadata.namespace, name: s.metadata.name, replicas: s.spec.replicas,
      ready: s.status.readyReplicas || 0,
      age: s.metadata.creationTimestamp,
      image: s.spec.template.spec.containers?.[0]?.image || '',
    })) || []
  },

  async daemonsets() {
    const data = await k8sGet('/apis/apps/v1/daemonsets')
    return data?.items?.map((d: any) => ({
      namespace: d.metadata.namespace, name: d.metadata.name,
      desired: d.status.desiredNumberScheduled || 0,
      ready: d.status.numberReady || 0,
      upToDate: d.status.updatedNumberScheduled || 0,
      available: d.status.numberAvailable || 0,
      age: d.metadata.creationTimestamp,
      image: d.spec.template.spec.containers?.[0]?.image || '',
    })) || []
  },

  async replicasets() {
    const data = await k8sGet('/apis/apps/v1/replicasets')
    return data?.items?.map((r: any) => ({
      namespace: r.metadata.namespace, name: r.metadata.name,
      desired: r.spec.replicas ?? 0,
      ready: r.status.readyReplicas || 0,
      available: r.status.availableReplicas || 0,
      age: r.metadata.creationTimestamp,
      owner: r.metadata.ownerReferences?.[0]?.name || '',
    })) || []
  },

  async cronjobs() {
    const data = await k8sGet('/apis/batch/v1/cronjobs')
    return data?.items?.map((c: any) => ({
      namespace: c.metadata.namespace, name: c.metadata.name,
      schedule: c.spec.schedule,
      suspend: c.spec.suspend ?? false,
      active: c.status.active?.length || 0,
      lastSchedule: c.status.lastScheduleTime,
      age: c.metadata.creationTimestamp,
    })) || []
  },

  async jobs() {
    const data = await k8sGet('/apis/batch/v1/jobs')
    return data?.items?.map((j: any) => ({
      namespace: j.metadata.namespace, name: j.metadata.name,
      completions: `${j.status.succeeded || 0}/${j.spec.completions || 1}`,
      duration: j.status.startTime && j.status.completionTime
        ? Math.round((new Date(j.status.completionTime).getTime() - new Date(j.status.startTime).getTime()) / 1000)
        : null,
      status: j.status.conditions?.[0]?.type || (j.status.active ? 'Running' : 'Unknown'),
      age: j.metadata.creationTimestamp,
    })) || []
  },

  async configmaps() {
    const data = await k8sGet('/api/v1/configmaps')
    return data?.items?.map((c: any) => ({
      namespace: c.metadata.namespace, name: c.metadata.name,
      keys: Object.keys(c.data || {}).length,
      age: c.metadata.creationTimestamp,
    })) || []
  },

  async secrets() {
    const data = await k8sGet('/api/v1/secrets')
    return data?.items?.map((s: any) => ({
      namespace: s.metadata.namespace, name: s.metadata.name,
      type: s.type,
      keys: Object.keys(s.data || {}).length,
      age: s.metadata.creationTimestamp,
    })) || []
  },

  // --- Write operations ---

  async deletePod(namespace: string, name: string) {
    return k8sWrite('DELETE', `/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(name)}`)
  },

  async restartDeployment(namespace: string, name: string) {
    return k8sWrite('PATCH', `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}`, {
      spec: { template: { metadata: { annotations: { 'kubectl.kubernetes.io/restartedAt': new Date().toISOString() } } } },
    })
  },

  async scaleDeployment(namespace: string, name: string, replicas: number) {
    return k8sWrite('PATCH', `/apis/apps/v1/namespaces/${encodeURIComponent(namespace)}/deployments/${encodeURIComponent(name)}/scale`, { spec: { replicas } })
  },

}
