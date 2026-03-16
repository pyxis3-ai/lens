import { config } from './config'
import { k8s, k8sGet } from './k8s'
import { metrics } from './metrics'
import { security } from './security'
import { health } from './health'
import { nginx } from './nginx'
import { store } from './db'
import { addClient, removeClient, getActiveAlerts, getAlertHistory, acknowledgeAlert, dismissAlert, getThresholds, updateThreshold } from './monitoring'
import { startExec, execMessage, stopExec } from './exec'

function clampInt(val: string | null, fallback: number, min: number, max: number): number {
  const n = parseInt(val || String(fallback))
  return isNaN(n) ? fallback : Math.max(min, Math.min(max, n))
}

const server = Bun.serve({
  port: config.port,
  async fetch(req) {
    const url = new URL(req.url)

    // WebSocket upgrades
    if (url.pathname === '/ws') {
      if ((server.upgrade as any)(req, { data: { type: 'broadcast' } })) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }
    if (url.pathname === '/ws/exec') {
      const namespace = url.searchParams.get('namespace') || ''
      const pod = url.searchParams.get('pod') || ''
      const container = url.searchParams.get('container') || ''
      if (!namespace || !pod || !container) return new Response('namespace, pod, and container required', { status: 400 })
      if ((server.upgrade as any)(req, { data: { type: 'exec', namespace, pod, container } })) return
      return new Response('WebSocket upgrade failed', { status: 400 })
    }

    // Auth check for non-health endpoints
    if (config.apiSecret && url.pathname !== '/api/health') {
      const auth = req.headers.get('x-api-secret') || req.headers.get('authorization')?.replace('Bearer ', '');
      if (auth !== config.apiSecret) return new Response('Unauthorized', { status: 401 });
    }

    // --- GET endpoints ---
    if (url.pathname === '/api/user') {
      const name = req.headers.get('Remote-Name') || req.headers.get('Remote-User') || ''
      const email = req.headers.get('Remote-Email') || ''
      return Response.json({ name, email, initial: name.charAt(0).toUpperCase() || '?' })
    }
    if (url.pathname === '/api/health') return Response.json({ status: 'ok' })
    if (url.pathname === '/api/system') return Response.json(await metrics.system())
    if (url.pathname === '/api/pods') return Response.json(await k8s.pods())
    if (url.pathname === '/api/namespaces') return Response.json(await k8s.namespaces())
    if (url.pathname === '/api/logs') {
      const ns = url.searchParams.get('namespace') || ''
      const pod = url.searchParams.get('pod') || ''
      const container = url.searchParams.get('container') || undefined
      const tail = clampInt(url.searchParams.get('tail'), 200, 1, 5000)
      if (!ns || !pod) return Response.json({ lines: [], error: 'namespace and pod required' })
      const lines = await k8s.podLogs(ns, pod, container, tail)
      return Response.json({ namespace: ns, pod, lines })
    }
    if (url.pathname === '/api/events') return Response.json(await k8s.events(clampInt(url.searchParams.get('limit'), 50, 1, 200)))
    if (url.pathname === '/api/security') return Response.json(await security.summary())
    if (url.pathname === '/api/security/fail2ban') return Response.json(await security.fail2ban())
    if (url.pathname === '/api/security/nginx') return Response.json(await security.nginxAttacks(clampInt(url.searchParams.get('lines'), 50, 1, 500)))
    if (url.pathname === '/api/security/ssh') return Response.json(await security.sshAttacks())
    if (url.pathname === '/api/security/authelia') return Response.json(await security.authelia())
    if (url.pathname === '/api/security/attacks') return Response.json(store.getAttacks(200))
    if (url.pathname === '/api/security/stats') return Response.json(store.getAttackStats())
    if (url.pathname === '/api/health/services') return Response.json(await health.check())
    if (url.pathname === '/api/certificates') return Response.json(await k8s.certificates())
    if (url.pathname === '/api/nginx') return Response.json(await nginx.analyze(clampInt(url.searchParams.get('lines'), 300, 1, 1000)))
    if (url.pathname === '/api/alerts') return Response.json(getActiveAlerts())
    if (url.pathname === '/api/alerts/history') return Response.json(getAlertHistory(50))
    if (url.pathname === '/api/alerts/thresholds') return Response.json(getThresholds())
    if (url.pathname === '/api/nodes') return Response.json(await k8s.nodes())
    if (url.pathname === '/api/pvcs') return Response.json(await k8s.pvcs())
    if (url.pathname === '/api/deployments') return Response.json(await k8s.deployments())
    if (url.pathname === '/api/statefulsets') return Response.json(await k8s.statefulsets())
    if (url.pathname === '/api/ingresses') return Response.json(await k8s.ingresses())
    if (url.pathname === '/api/services') return Response.json(await k8s.services())
    if (url.pathname === '/api/daemonsets') return Response.json(await k8s.daemonsets())
    if (url.pathname === '/api/replicasets') return Response.json(await k8s.replicasets())
    if (url.pathname === '/api/cronjobs') return Response.json(await k8s.cronjobs())
    if (url.pathname === '/api/jobs') return Response.json(await k8s.jobs())
    if (url.pathname === '/api/configmaps') return Response.json(await k8s.configmaps())
    if (url.pathname === '/api/secrets') return Response.json(await k8s.secrets())
    if (url.pathname === '/api/describe') {
      const kind = url.searchParams.get('kind') || ''
      const ns = url.searchParams.get('namespace') || ''
      const name = url.searchParams.get('name') || ''
      const ens = encodeURIComponent(ns)
      const ename = encodeURIComponent(name)
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
      const path = paths[kind]
      if (!path) return Response.json({ error: 'unknown kind' }, { status: 400 })
      return Response.json(await k8sGet(path))
    }

    // --- POST endpoints ---
    if (req.method === 'POST') {
      if (url.pathname === '/api/pod/delete') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        const { namespace, name } = body
        if (typeof namespace !== 'string' || typeof name !== 'string' || !namespace || !name) return Response.json({ ok: false, error: 'invalid params' }, { status: 400 })
        return Response.json(await k8s.deletePod(namespace, name))
      }
      if (url.pathname === '/api/deployment/restart') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        const { namespace, name } = body
        if (typeof namespace !== 'string' || typeof name !== 'string' || !namespace || !name) return Response.json({ ok: false, error: 'invalid params' }, { status: 400 })
        return Response.json(await k8s.restartDeployment(namespace, name))
      }
      if (url.pathname === '/api/deployment/scale') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        const { namespace, name, replicas } = body
        if (typeof namespace !== 'string' || typeof name !== 'string' || !namespace || !name) return Response.json({ ok: false, error: 'invalid params' }, { status: 400 })
        const r = parseInt(replicas)
        if (isNaN(r) || r < 0 || r > config.maxReplicas) return Response.json({ ok: false, error: `replicas must be 0-${config.maxReplicas}` }, { status: 400 })
        return Response.json(await k8s.scaleDeployment(namespace, name, r))
      }
      if (url.pathname === '/api/alerts/ack') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        const { id } = body
        if (typeof id !== 'string' || !id) return Response.json({ ok: false }, { status: 400 })
        return Response.json(acknowledgeAlert(id))
      }
      if (url.pathname === '/api/alerts/dismiss') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        const { id } = body
        if (typeof id !== 'string' || !id) return Response.json({ ok: false }, { status: 400 })
        return Response.json(dismissAlert(id))
      }
      if (url.pathname === '/api/alerts/thresholds') {
        let body; try { body = await req.json() } catch { return Response.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }) }
        if (typeof body.id !== 'string' || !body.id) return Response.json({ ok: false }, { status: 400 })
        const warn = Math.max(0, Math.min(100, parseFloat(body.warn) || 0))
        const crit = Math.max(0, Math.min(100, parseFloat(body.crit) || 0))
        return Response.json(updateThreshold(body.id, warn, crit))
      }
    }

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
