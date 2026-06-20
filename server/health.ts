import { k8s } from './k8s'
import { config } from './config'

export const health = {
  async check() {
    const ingresses = await k8s.ingresses()
    const hosts = new Map<string, { namespace: string; path: string }>()

    for (const ing of ingresses) {
      for (const host of ing.hosts) {
        if (!host) continue
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
            tls: { rejectUnauthorized: false },
          })
          return { name: host.split('.')[0], host, namespace, status: res.status, ok: res.status < 500, latency: Math.round(performance.now() - start) }
        } catch (e: any) {
          return { name: host.split('.')[0], host, namespace, status: 0, ok: false, latency: Math.round(performance.now() - start), error: e.message?.slice(0, 80) }
        }
      })
    )

    return results.sort((a, b) => a.host.localeCompare(b.host))
  },
}
