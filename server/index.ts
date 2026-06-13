import { resolve } from 'path'
import { config } from './config'
import { k8s, k8sGet } from './k8s'
import { metrics } from './metrics'
import { security } from './security'
import { health } from './health'
import { nginx } from './nginx'
import { store } from './db'
import { addClient, removeClient, getActiveAlerts, getAlertHistory, acknowledgeAlert, dismissAlert, getThresholds, updateThreshold } from './monitoring'
import { startExec, execMessage, stopExec } from './exec'
import { llm } from './llm'

function clampInt(val: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(val || String(fallback))
  return isNaN(n) ? fallback : Math.max(min, Math.min(max, n))
}

const GET_ROUTES: Record<string, () => unknown> = {
  '/api/health': () => ({ status: 'ok' }),
  '/api/system': () => metrics.system(),
  '/api/pods': () => k8s.pods(),
  '/api/namespaces': () => k8s.namespaces(),
  '/api/nodes': () => k8s.nodes(),
  '/api/pvcs': () => k8s.pvcs(),
  '/api/deployments': () => k8s.deployments(),
  '/api/statefulsets': () => k8s.statefulsets(),
  '/api/ingresses': () => k8s.ingresses(),
  '/api/services': () => k8s.services(),
  '/api/daemonsets': () => k8s.daemonsets(),
  '/api/replicasets': () => k8s.replicasets(),
  '/api/cronjobs': () => k8s.cronjobs(),
  '/api/jobs': () => k8s.jobs(),
  '/api/configmaps': () => k8s.configmaps(),
  '/api/secrets': () => k8s.secrets(),
  '/api/certificates': () => k8s.certificates(),
  '/api/security': () => security.summary(),
  '/api/security/fail2ban': () => security.fail2ban(),
  '/api/security/ssh': () => security.sshAttacks(),
  '/api/security/authelia': () => security.authelia(),
  '/api/security/attacks': () => store.getAttacks(200),
  '/api/security/stats': () => store.getAttackStats(),
  '/api/health/services': () => health.check(),
  '/api/alerts': () => getActiveAlerts(),
  '/api/alerts/history': () => getAlertHistory(50),
  '/api/alerts/thresholds': () => getThresholds(),
}

const server = Bun.serve({
  port: config.port,
  reusePort: true,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname
    const q = url.searchParams

    if (path === '/ws') {
      if ((server.upgrade as any)(req, { data: { type: 'broadcast' } })) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
    if (path === '/ws/exec') {
      const namespace = q.get('namespace') || '', pod = q.get('pod') || '', container = q.get('container') || ''
      if (!namespace || !pod || !container) return new Response('namespace, pod, and container required', { status: 400 })
      if ((server.upgrade as any)(req, { data: { type: 'exec', namespace, pod, container } })) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    if (config.apiSecret && path !== '/api/health') {
      const auth = req.headers.get('x-api-secret') || req.headers.get('authorization')?.replace('Bearer ', '')
      if (auth !== config.apiSecret) return new Response('Unauthorized', { status: 401 })
    }

    if (req.method === 'GET') {
      if (path === '/api/user') {
        const name = req.headers.get('Remote-Name') || req.headers.get('Remote-User') || ''
        return Response.json({ name, email: req.headers.get('Remote-Email') || '', initial: name.charAt(0).toUpperCase() || '?' })
      }
      if (path === '/api/logs') {
        const ns = q.get('namespace') || '', pod = q.get('pod') || ''
        if (!ns || !pod) return Response.json({ lines: [], error: 'namespace and pod required' })
        const lines = await k8s.podLogs(ns, pod, q.get('container') || undefined, clampInt(q.get('tail'), 200, 1, 5000))
        return Response.json({ namespace: ns, pod, lines })
      }
      if (path === '/api/events') return Response.json(await k8s.events(clampInt(q.get('limit'), 50, 1, 200)))
      if (path === '/api/security/nginx') return Response.json(await security.nginxAttacks(clampInt(q.get('lines'), 50, 1, 500)))
      if (path === '/api/nginx') return Response.json(await nginx.analyze(clampInt(q.get('lines'), 300, 1, 1000)))
      if (path === '/api/llm') return Response.json(await llm.endpoints(q.get('force') === '1'))
      if (path === '/api/describe') {
        const ens = encodeURIComponent(q.get('namespace') || ''), ename = encodeURIComponent(q.get('name') || '')
        const paths: Record<string, string> = {
          pod: `/api/v1/namespaces/${ens}/pods/${ename}`,
          deployment: `/apis/apps/v1/namespaces/${ens}/deployments/${ename}`,
          statefulset: `/apis/apps/v1/namespaces/${ens}/statefulsets/${ename}`,
          daemonset: `/apis/apps/v1/namespaces/${ens}/daemonsets/${ename}`,
          service: `/api/v1/namespaces/${ens}/services/${ename}`,
          configmap: `/api/v1/namespaces/${ens}/configmaps/${ename}`,
          secret: `/api/v1/namespaces/${ens}/secrets/${ename}`,
          pvc: `/api/v1/namespaces/${ens}/persistentvolumeclaims/${ename}`,
          ingress: `/apis/networking.k8s.io/v1/namespaces/${ens}/ingresses/${ename}`,
          cronjob: `/apis/batch/v1/namespaces/${ens}/cronjobs/${ename}`,
          job: `/apis/batch/v1/namespaces/${ens}/jobs/${ename}`,
        }
        const p = paths[q.get('kind') || '']
        return p ? Response.json(await k8sGet(p)) : Response.json({ error: 'unknown kind' }, { status: 400 })
      }
      const producer = GET_ROUTES[path]
      if (producer) return Response.json(await producer())
    }

    if (req.method === 'POST') {
      let body: any
      try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
      const { namespace, name, id } = body
      const hasNsName = typeof namespace === 'string' && !!namespace && typeof name === 'string' && !!name
      const bad = (error = 'invalid params') => Response.json({ ok: false, error }, { status: 400 })
      const hasId = typeof id === 'string' && !!id

      if (path === '/api/pod/delete') return hasNsName ? Response.json(await k8s.deletePod(namespace, name)) : bad()
      if (path === '/api/deployment/restart') return hasNsName ? Response.json(await k8s.restartDeployment(namespace, name)) : bad()
      if (path === '/api/deployment/scale') {
        if (!hasNsName) return bad()
        const r = parseInt(body.replicas)
        if (isNaN(r) || r < 0 || r > config.maxReplicas) return bad(`replicas must be 0-${config.maxReplicas}`)
        return Response.json(await k8s.scaleDeployment(namespace, name, r))
      }
      if (path === '/api/alerts/ack') return hasId ? Response.json(acknowledgeAlert(id)) : Response.json({ ok: false }, { status: 400 })
      if (path === '/api/alerts/dismiss') return hasId ? Response.json(dismissAlert(id)) : Response.json({ ok: false }, { status: 400 })
      if (path === '/api/alerts/thresholds') {
        if (!hasId) return Response.json({ ok: false }, { status: 400 })
        const clamp = (v: any) => Math.max(0, Math.min(100, parseFloat(v) || 0))
        return Response.json(updateThreshold(id, clamp(body.warn), clamp(body.crit)))
      }
    }

    const distRoot = resolve(import.meta.dir, '..', 'dist')
    const requestedPath = resolve(distRoot, '.' + (path === '/' ? '/index.html' : path))
    if (!requestedPath.startsWith(distRoot)) return new Response('Forbidden', { status: 403 })
    const file = Bun.file(requestedPath)
    if (await file.exists()) return new Response(file)
    const index = Bun.file(`${distRoot}/index.html`)
    if (await index.exists()) return new Response(index)

    return new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws: any) {
      if (ws.data?.type === 'exec') startExec(ws)
      else addClient(ws)
    },
    close(ws: any) {
      if (ws.data?.type === 'exec') stopExec(ws)
      else removeClient(ws)
    },
    message(ws: any, msg: any) {
      if (ws.data?.type === 'exec') execMessage(ws, msg)
    },
  },
})

console.log(`Lens server running on http://localhost:${server.port}`)
