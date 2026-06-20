import { k8sGet } from './k8s'
import { memo } from './cache'
import type { LLMEndpoint } from '../src/lib/types'

const DEFAULT_PORTS = [8000, 3000, 8080, 5000, 11434, 8888, 8081, 4000]

const PROBE_TIMEOUT_MS = 1500

const RUNTIME_PATTERNS: [RegExp, string][] = [
  [/vllm/i, 'vllm'],
  [/text-generation-inference|tgi/i, 'tgi'],
  [/llama[._ -]?cpp|llama-?server/i, 'llama.cpp'],
  [/ollama/i, 'ollama'],
  [/sglang/i, 'sglang'],
  [/triton/i, 'triton'],
  [/infinity/i, 'infinity'],
]

const OWNED_BY: Record<string, string> = {
  vllm: 'vllm', llamacpp: 'llama.cpp', 'llama.cpp': 'llama.cpp',
  tgi: 'tgi', huggingface: 'tgi', ollama: 'ollama', sglang: 'sglang',
}

const matchRuntime = (s: string) => RUNTIME_PATTERNS.find(([rx]) => rx.test(s))?.[1]
const isInferenceImage = (img?: string) =>
  !!img && (!!matchRuntime(img) || /lorax|huggingface|openai|mistral|llm|inference|embed/i.test(img))

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

  return out.sort((a, b) => Number(isInferenceImage(b.image)) - Number(isInferenceImage(a.image)))
}

function detectRuntime(modelsJson: any, headers: Headers, image?: string): string {
  const ownedBy = String(modelsJson?.data?.[0]?.owned_by ?? '').toLowerCase()
  const ollamaShape = Array.isArray(modelsJson?.models) && !Array.isArray(modelsJson?.data)
  return OWNED_BY[ownedBy]
    || matchRuntime(headers.get('server') || '')
    || (image ? matchRuntime(image) : undefined)
    || (ollamaShape ? 'ollama' : 'openai-compat')
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

const scan = memo<LLMEndpoint[]>(30_000, async () => {
  const candidates = await listServiceCandidates()

  const BATCH = 16
  const results: LLMEndpoint[] = []
  for (let i = 0; i < candidates.length; i += BATCH) {
    const settled = await Promise.all(candidates.slice(i, i + BATCH).map(probe))
    for (const r of settled) if (r) results.push(r)
  }

  const byKey = new Map<string, LLMEndpoint>()
  for (const r of results) {
    const key = `${r.namespace}/${[...r.models].sort().join(',')}`
    const prev = byKey.get(key)
    if (!prev || r.latencyMs < prev.latencyMs) byKey.set(key, r)
  }

  return [...byKey.values()].sort((a, b) =>
    a.namespace === b.namespace
      ? a.service.localeCompare(b.service)
      : a.namespace.localeCompare(b.namespace),
  )
})

export const llm = {
  endpoints(force = false): Promise<LLMEndpoint[]> {
    return scan(force)
  },
}
