import { k8sGetToken } from './k8s'
import { config } from './config'
const sessions = new Map<any, WebSocket>()
const encoder = new TextEncoder()

const CH_STDIN = 0, CH_STDOUT = 1, CH_STDERR = 2, CH_RESIZE = 3

export async function startExec(clientWs: any) {
  const { namespace, pod, container } = clientWs.data
  const token = await k8sGetToken()
  if (!token) {
    clientWs.send('\r\n[exec] No service account token available\r\n')
    clientWs.close()
    return
  }

  const cmd = encodeURIComponent('/bin/sh')
  const params = `container=${encodeURIComponent(container)}&command=${cmd}&stdin=1&stdout=1&stderr=1&tty=1`
  const url = `${config.k8sWs}/api/v1/namespaces/${encodeURIComponent(namespace)}/pods/${encodeURIComponent(pod)}/exec?${params}`

  try {
    // Pass subprotocol via URL param (k8s also accepts it) + auth via header
    const wsUrl = `${url}&protocols=v4.channel.k8s.io`
    // @ts-ignore - Bun WebSocket supports headers + tls options
    const k8sWs = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${token}`, 'Sec-WebSocket-Protocol': 'v4.channel.k8s.io' }, tls: { rejectUnauthorized: false } })

    k8sWs.binaryType = 'arraybuffer'

    k8sWs.onopen = () => {
      // Guard: browser may have disconnected while k8s WS was connecting
      if (clientWs.readyState !== WebSocket.OPEN) { k8sWs.close(); return }
      sessions.set(clientWs, k8sWs)
      try { clientWs.send('\x1b[32m[exec]\x1b[0m Connected to ' + namespace + '/' + pod + ':' + container + '\r\n') } catch {}
    }

    k8sWs.onmessage = (event: MessageEvent) => {
      try {
        const data = new Uint8Array(event.data as ArrayBuffer)
        if (data.length < 2) return

        const channel = data[0]
        const payload = data.slice(1)

        if (channel === CH_STDOUT || channel === CH_STDERR) {
          // stdout or stderr → send to browser as text
          const text = new TextDecoder().decode(payload)
          clientWs.send(text)
        }
      } catch (e) { console.error('[exec] message error:', e) }
    }

    k8sWs.onclose = () => {
      sessions.delete(clientWs)
      try { clientWs.send('\r\n\x1b[31m[exec]\x1b[0m Session closed\r\n') } catch {}
      try { clientWs.close() } catch {}
    }

    k8sWs.onerror = (e: Event) => {
      console.error('[exec] k8s WebSocket error:', (e as ErrorEvent).message || 'unknown')
      sessions.delete(clientWs)
      try { clientWs.send('\r\n\x1b[31m[exec]\x1b[0m Connection error\r\n') } catch {}
      try { clientWs.close() } catch {}
    }
  } catch (e) {
    clientWs.send(`\r\n[exec] Failed to connect: ${(e as Error).message}\r\n`)
    clientWs.close()
  }
}

export function execMessage(clientWs: any, msg: string | Buffer) {
  const k8sWs = sessions.get(clientWs)
  if (!k8sWs || k8sWs.readyState !== WebSocket.OPEN) return

  if (typeof msg === 'string') {
    // Check for resize message
    try {
      const parsed = JSON.parse(msg)
      if (parsed.type === 'resize') {
        // Channel 3 = resize, payload is JSON { Width, Height }
        const resizePayload = JSON.stringify({ Width: parsed.cols, Height: parsed.rows })
        const encoded = encoder.encode(resizePayload)
        const buf = new Uint8Array(1 + encoded.length)
        buf[0] = CH_RESIZE
        buf.set(encoded, 1)
        k8sWs.send(buf)
        return
      }
    } catch {}

    const encoded = encoder.encode(msg)
    const buf = new Uint8Array(1 + encoded.length)
    buf[0] = CH_STDIN
    buf.set(encoded, 1)
    k8sWs.send(buf)
  }
}

export function stopExec(clientWs: any) {
  const k8sWs = sessions.get(clientWs)
  if (k8sWs) {
    try { k8sWs.close() } catch {}
    sessions.delete(clientWs)
  }
}
