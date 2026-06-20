import { readFile } from 'fs/promises'
import { config } from './config'
import { memo } from './cache'

const API = config.k8sApi

const readToken = memo(config.tokenCacheTTL, async () => (await readFile(config.k8sTokenPath, 'utf-8')).trim())

export async function k8sGetToken(): Promise<string> {
  try {
    return await readToken()
  } catch (e) {
    console.error('[k8s] Failed to read SA token:', (e as Error).message)
    return ''
  }
}

export async function k8sGet(path: string): Promise<any> {
  const t = await k8sGetToken()
  if (!t) return null
  try {
    const res = await fetch(`${API}${path}`, {
      headers: { Authorization: `Bearer ${t}` },
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

const list = async (path: string, shape: (item: any) => any): Promise<any[]> => ((await k8sGet(path))?.items || []).map(shape)

const meta = (x: any) => ({ namespace: x.metadata.namespace, name: x.metadata.name, age: x.metadata.creationTimestamp })

export const k8s = {

  async pods() {
    const [podData, topData] = await Promise.all([
      k8sGet('/api/v1/pods'),
      k8sGet('/apis/metrics.k8s.io/v1beta1/pods'),
    ])
    if (!podData?.items) return []

    const metricsAvailable = !!topData?.items

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

      const containers = (p.spec.containers || []).map((c: any) => {
        const cStatus = p.status.containerStatuses?.find((s: any) => s.name === c.name)
        const cMetrics = containerMetrics[`${podKey}/${c.name}`]
        return {
          name: c.name,
          ready: cStatus?.ready ?? false,
          restarts: cStatus?.restartCount || 0,
          state: cStatus?.state ? Object.keys(cStatus.state)[0] : 'unknown',
          cpu: cMetrics ? cMetrics.cpu : null,
          memory: cMetrics ? cMetrics.memory : null,
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
        ...meta(p),
        status: p.status.phase,
        ready: readyCount === totalCount && totalCount > 0,
        readyCount,
        totalCount,
        restarts: statuses.reduce((s: number, c: any) => s + (c.restartCount || 0), 0),
        containers,
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

  async podLogs(namespace: string, pod: string, container?: string, tail = 200) {
    const t = await k8sGetToken()
    if (!t || !namespace || !pod) return []

    const base = `${API}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/log?tailLines=${tail}`
    const fetchLog = async (cname: string) => {
      const res = await fetch(`${base}&container=${encodeURIComponent(cname)}`, { headers: { Authorization: `Bearer ${t}` }, tls: { rejectUnauthorized: false } as any })
      return res.ok ? (await res.text()).split('\n').filter(Boolean) : [`Error: ${res.status}`]
    }

    if (container) return fetchLog(container)

    const podInfo = await k8sGet(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}`)
    if (!podInfo?.spec?.containers) return ['Error: pod not found']

    const containers: string[] = podInfo.spec.containers.map((c: any) => c.name)
    const logs: string[] = []
    for (const cname of containers) {
      if (containers.length > 1) logs.push(`─── ${cname} ───`)
      logs.push(...(await fetchLog(cname)))
    }
    return logs
  },

  podsByLabel(namespace: string, label: string): Promise<string[]> {
    return list(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods?labelSelector=${encodeURIComponent(label)}`, (p: any) => p.metadata.name)
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
            if (['MemoryPressure', 'DiskPressure', 'PIDPressure', 'NetworkUnavailable'].includes(c.type)) return c.status === 'True'
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

  certificates() {
    return list('/apis/cert-manager.io/v1/certificates', (c: any) => ({
      name: c.metadata.name, namespace: c.metadata.namespace,
      ready: c.status?.conditions?.find((x: any) => x.type === 'Ready')?.status === 'True',
      notAfter: c.status?.notAfter, renewalTime: c.status?.renewalTime, dnsNames: c.spec?.dnsNames,
    }))
  },

  ingresses() {
    return list('/apis/networking.k8s.io/v1/ingresses', (i: any) => ({
      ...meta(i),
      class: i.spec?.ingressClassName || i.metadata.annotations?.['kubernetes.io/ingress.class'] || '',
      hosts: i.spec?.rules?.map((r: any) => r.host).filter(Boolean) || [],
      healthPath: i.metadata.annotations?.['lens.pyxis3.ai/health-path'] || '/',
      address: i.status?.loadBalancer?.ingress?.[0]?.ip || '',
      tls: !!i.spec?.tls?.length,
    }))
  },

  pvcs() {
    return list('/api/v1/persistentvolumeclaims', (p: any) => ({
      ...meta(p), status: p.status.phase,
      volume: p.spec.volumeName || '',
      capacity: p.status.capacity?.storage || p.spec.resources?.requests?.storage || '?',
      storageClass: p.spec.storageClassName, accessModes: p.spec.accessModes,
    }))
  },

  services() {
    return list('/api/v1/services', (s: any) => ({
      ...meta(s),
      type: s.spec.type,
      clusterIP: s.spec.clusterIP,
      externalIP: s.status?.loadBalancer?.ingress?.[0]?.ip || s.spec.externalIPs?.[0] || '',
      ports: (s.spec.ports || []).map((p: any) => `${p.port}${p.nodePort ? ':' + p.nodePort : ''}/${p.protocol}`).join(', '),
    }))
  },

  deployments() {
    return list('/apis/apps/v1/deployments', (d: any) => ({
      ...meta(d), replicas: d.spec.replicas,
      ready: d.status.readyReplicas || 0,
      upToDate: d.status.updatedReplicas || 0,
      available: d.status.availableReplicas || 0,
      image: d.spec.template.spec.containers?.[0]?.image || '',
      conditions: (d.status.conditions || []).map((c: any) => ({ type: c.type, status: c.status })),
    }))
  },

  statefulsets() {
    return list('/apis/apps/v1/statefulsets', (s: any) => ({
      ...meta(s), replicas: s.spec.replicas,
      ready: s.status.readyReplicas || 0,
      image: s.spec.template.spec.containers?.[0]?.image || '',
    }))
  },

  daemonsets() {
    return list('/apis/apps/v1/daemonsets', (d: any) => ({
      ...meta(d),
      desired: d.status.desiredNumberScheduled || 0,
      ready: d.status.numberReady || 0,
      upToDate: d.status.updatedNumberScheduled || 0,
      available: d.status.numberAvailable || 0,
      image: d.spec.template.spec.containers?.[0]?.image || '',
    }))
  },

  replicasets() {
    return list('/apis/apps/v1/replicasets', (r: any) => ({
      ...meta(r),
      desired: r.spec.replicas ?? 0,
      ready: r.status.readyReplicas || 0,
      available: r.status.availableReplicas || 0,
      owner: r.metadata.ownerReferences?.[0]?.name || '',
    }))
  },

  cronjobs() {
    return list('/apis/batch/v1/cronjobs', (c: any) => ({
      ...meta(c),
      schedule: c.spec.schedule,
      suspend: c.spec.suspend ?? false,
      active: c.status.active?.length || 0,
      lastSchedule: c.status.lastScheduleTime,
    }))
  },

  jobs() {
    return list('/apis/batch/v1/jobs', (j: any) => ({
      ...meta(j),
      completions: `${j.status.succeeded || 0}/${j.spec.completions || 1}`,
      duration: j.status.startTime && j.status.completionTime
        ? Math.round((new Date(j.status.completionTime).getTime() - new Date(j.status.startTime).getTime()) / 1000)
        : null,
      status: j.status.conditions?.[0]?.type || (j.status.active ? 'Running' : 'Unknown'),
    }))
  },

  configmaps() {
    return list('/api/v1/configmaps', (c: any) => ({
      ...meta(c),
      keys: Object.keys(c.data || {}).length,
    }))
  },

  secrets() {
    return list('/api/v1/secrets', (s: any) => ({
      ...meta(s),
      type: s.type,
      keys: Object.keys(s.data || {}).length,
    }))
  },

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
