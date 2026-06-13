
import { k8sGet } from './k8s'

const DEFAULT_PORTS = [8000, 3000, 8080, 5000, 11434, 8888, 8081, 4000]

const PROBE_TIMEOUT_MS = 1500

const INFERENCE_IMAGE_HINTS = [
  /vllm/i, /text-generation-inference/i, /tgi/i, /llama[._-]?cpp/i,
  /ollama/i, /sglang/i, /triton/i, /lorax/i, /huggingface/i, /infinity/i,
  /openai/i, /mistral/i, /llm/i, /inference/i, /embed/i,
]

export interface LLMEndpoint {
  namespace: string
  service: string
  port: number
  url: string
  status: 'ok' | 'partial' | 'down'
  models: string[]
  latencyMs: number
  runtime: string
  servedBy?: string
  error?: string
}

interface PortCandidate {
  namespace: string
  service: string
  port: number
  image?: string
}

async function listServiceCandidates(): Promise<PortCandidate[]> {
  const [svcs, pods] = await Promise.all([
    k8sGet('/api/v1/services'),
    k8sGet('/api/v1/pods'),
  ])
  if (!svcs?.items) return []

  const podImageByLabel: Record<string, string> = {}
  for (const p of pods?.items || []) {
    const ns = p.metadata?.namespace
    const labels = p.metadata?.labels || {}
    const image = p.spec?.containers?.[0]?.image
    if (!ns || !image) continue
    for (const [k, v] of Object.entries(labels)) {
      podImageByLabel[`${ns}/${k}=${v}`] = String(image)
    }
  }

  const out: PortCandidate[] = []
  for (const s of svcs.items) {
    const ns = s.metadata?.namespace
    const name = s.metadata?.name
    if (!ns || !name) continue

    let image: string | undefined
    const sel = s.spec?.selector || {}
    for (const [k, v] of Object.entries(sel)) {
      const hit = podImageByLabel[`${ns}/${k}=${v}`]
      if (hit) { image = hit; break }
    }

    const specPorts = (s.spec?.ports || [])
      .filter((p: any) => !p.protocol || p.protocol === 'TCP')
      .map((p: any) => p.port)
      .filter((p: any) => typeof p === 'number')

    const ports = specPorts.length > 0 ? specPorts : DEFAULT_PORTS
    for (const port of ports) {
      out.push({ namespace: ns, service: name, port, image })
    }
  }

  out.sort((a, b) => {
    const aHit = a.image && INFERENCE_IMAGE_HINTS.some(rx => rx.test(a.image!))
    const bHit = b.image && INFERENCE_IMAGE_HINTS.some(rx => rx.test(b.image!))
    if (aHit && !bHit) return -1
    if (bHit && !aHit) return 1
    return 0
  })

  return out
}

function detectRuntime(modelsJson: any, headers: Headers, image?: string): string {
  const ownedBy = String(modelsJson?.data?.[0]?.owned_by ?? '').toLowerCase()
  if (ownedBy === 'vllm') return 'vllm'
  if (ownedBy === 'llamacpp' || ownedBy === 'llama.cpp') return 'llama.cpp'
  if (ownedBy === 'tgi' || ownedBy === 'huggingface') return 'tgi'
  if (ownedBy === 'ollama') return 'ollama'
  if (ownedBy === 'sglang') return 'sglang'

  const server = headers.get('server') || ''
  if (/vllm/i.test(server)) return 'vllm'
  if (/text-generation-inference/i.test(server) || /TGI/.test(server)) return 'tgi'
  if (/ollama/i.test(server)) return 'ollama'
  if (/llama[. _-]?cpp/i.test(server) || /llama-server/i.test(server)) return 'llama.cpp'

  if (image) {
    if (/vllm/i.test(image)) return 'vllm'
    if (/text-generation-inference|tgi/i.test(image)) return 'tgi'
    if (/llama[._ -]?cpp/i.test(image) || /llama-?server/i.test(image)) return 'llama.cpp'
    if (/ollama/i.test(image)) return 'ollama'
    if (/sglang/i.test(image)) return 'sglang'
    if (/triton/i.test(image)) return 'triton'
    if (/infinity/i.test(image)) return 'infinity'
  }

  if (Array.isArray(modelsJson?.models) && !Array.isArray(modelsJson?.data)) return 'ollama'
  return 'openai-compat'
}

async function probe(c: PortCandidate): Promise<LLMEndpoint | null> {
  const dns = `${c.service}.${c.namespace}.svc.cluster.local`
  const url = `http://${dns}:${c.port}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  const t0 = performance.now()
  try {
    const res = await fetch(`${url}/v1/models`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    })
    const latencyMs = Math.round(performance.now() - t0)
    if (!res.ok) return null

    const ct = res.headers.get('content-type') || ''
    if (!ct.includes('json')) return null

    const body = await res.json().catch(() => null)
    if (!body) return null

    let models: string[] = []
    if (Array.isArray(body?.data)) {
      models = body.data
        .map((m: any) => m?.id)
        .filter((id: any): id is string => typeof id === 'string')
    }
    if (models.length === 0) return null

    return {
      namespace: c.namespace,
      service: c.service,
      port: c.port,
      url,
      status: 'ok',
      models,
      latencyMs,
      runtime: detectRuntime(body, res.headers, c.image),
      servedBy: c.image,
    }
  } catch (err: any) {
    return null
  } finally {
    clearTimeout(timer)
  }
}

let cache: { at: number; data: LLMEndpoint[] } | null = null
const CACHE_TTL_MS = 30_000

export const llm = {
  async endpoints(force = false): Promise<LLMEndpoint[]> {
    if (!force && cache && (Date.now() - cache.at) < CACHE_TTL_MS) {
      return cache.data
    }
    const candidates = await listServiceCandidates()

    const BATCH = 16
    const results: LLMEndpoint[] = []
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH)
      const settled = await Promise.all(slice.map(probe))
      for (const r of settled) if (r) results.push(r)
    }

    const byKey = new Map<string, LLMEndpoint>()
    for (const r of results) {
      const key = `${r.namespace}/${[...r.models].sort().join(',')}`
      const prev = byKey.get(key)
      if (!prev || r.latencyMs < prev.latencyMs) byKey.set(key, r)
    }

    const data = [...byKey.values()].sort((a, b) =>
      a.namespace === b.namespace
        ? a.service.localeCompare(b.service)
        : a.namespace.localeCompare(b.namespace),
    )
    cache = { at: Date.now(), data }
    return data
  },
}
