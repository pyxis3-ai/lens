import { k8s } from './k8s'
import { config } from './config'

let _cache: any[] = []
let _lastCheck = 0

export const health = {
  async check() {
    if (Date.now() - _lastCheck < config.healthInterval && _cache.length) return _cache

    const ingresses = await k8s.ingresses()
    const hosts = new Map<string, { namespace: string; path: string }>()

    for (const ing of ingresses) {
      for (const host of ing.hosts) {
        if (!host) continue
        // First ingress wins for namespace; a non-default health-path wins regardless of order
        // (mergeable master/minion ingresses share a host — the annotation may live on either).
        const cur = hosts.get(host)
        if (!cur) hosts.set(host, { namespace: ing.namespace, path: ing.healthPath })
        else if (ing.healthPath !== '/' && cur.path === '/') cur.path = ing.healthPath
      }
    }

    const results = await Promise.all(
      [...hosts.entries()].map(async ([host, { namespace, path }]) => {
        const url = `https://${host}${path}`
        const start = performance.now()
        try {
          const res = await fetch(url, {
            redirect: 'manual',
            signal: AbortSignal.timeout(config.healthTimeout),
            // @ts-ignore
            tls: { rejectUnauthorized: false },
          })
          const latency = Math.round(performance.now() - start)
          return {
            name: host.split('.')[0],
            host,
            namespace,
            status: res.status,
            ok: res.status < 500,
            latency,
          }
        } catch (e: any) {
          return {
            name: host.split('.')[0],
            host,
            namespace,
            status: 0,
            ok: false,
            latency: Math.round(performance.now() - start),
            error: e.message?.slice(0, 80),
          }
        }
      })
    )

    _cache = results.sort((a, b) => a.host.localeCompare(b.host))
    _lastCheck = Date.now()
    return _cache
  },
}
