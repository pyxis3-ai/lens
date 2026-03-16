import { k8s } from './k8s'
import { config } from './config'

let _cache: any[] = []
let _lastCheck = 0

export const health = {
  async check() {
    if (Date.now() - _lastCheck < config.healthInterval && _cache.length) return _cache

    const ingresses = await k8s.ingresses()
    const hosts = new Map<string, string>()

    for (const ing of ingresses) {
      for (const host of ing.hosts) {
        if (host && !hosts.has(host)) {
          hosts.set(host, ing.namespace)
        }
      }
    }

    const results = await Promise.all(
      [...hosts.entries()].map(async ([host, namespace]) => {
        const url = `https://${host}/`
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
