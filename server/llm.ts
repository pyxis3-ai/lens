// LLM/inference endpoint discovery for in-cluster OpenAI-compatible services.
//
// Scans every Service in the cluster, probes plausible TCP ports for an
// OpenAI-compatible /v1/models response, and reports the served model list +
// time-to-first-byte latency. Covers vLLM, TGI, llama.cpp, Ollama, sglang, and
// anything else that exposes the OpenAI HTTP API.
//
// No outbound traffic — probes are in-cluster DNS only (svc.ns.svc.cluster.local).
// No inference is performed; only the cheap GET /v1/models call.

import { k8sGet } from './k8s'

// Ports commonly used by OSS inference servers
const DEFAULT_PORTS = [8000, 3000, 8080, 5000, 11434, 8888, 8081, 4000]

// Probe timeout — kept short so a full cluster scan stays snappy
const PROBE_TIMEOUT_MS = 1500

// Heuristic image-name patterns that suggest an inference workload, used to
// rank candidates first (we still probe everything, this just orders results)
const INFERENCE_IMAGE_HINTS = [
  /vllm/i, /text-generation-inference/i, /tgi/i, /llama[._-]?cpp/i,
  /ollama/i, /sglang/i, /triton/i, /lorax/i, /huggingface/i, /infinity/i,
  /openai/i, /mistral/i, /llm/i, /inference/i, /embed/i,
]

export interface LLMEndpoint {
  namespace: string
  service: string
  port: number
  url: string            // e.g. http://svc.ns.svc.cluster.local:8000
  status: 'ok' | 'partial' | 'down'  // ok = /v1/models returned model list
  models: string[]       // model IDs reported by /v1/models
  latencyMs: number      // wall time of the /v1/models GET
  runtime: string        // inferred runtime: vllm | tgi | llama.cpp | ollama | openai-compat | unknown
  servedBy?: string      // first container image hint, if available
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

  // Build a map: namespace/selectorLabels -> first container image
  // Used to attribute a service to its backing pod's image for heuristic ranking.
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

    // Try to find the backing pod image by matching the service selector
    let image: string | undefined
    const sel = s.spec?.selector || {}
    for (const [k, v] of Object.entries(sel)) {
      const hit = podImageByLabel[`${ns}/${k}=${v}`]
      if (hit) { image = hit; break }
    }

    // Collect ports from the service spec, plus DEFAULT_PORTS as fallback
    // (some services expose a single named "http" port at an odd number)
    const specPorts = (s.spec?.ports || [])
      .filter((p: any) => !p.protocol || p.protocol === 'TCP')
      .map((p: any) => p.port)
      .filter((p: any) => typeof p === 'number')

    const ports = specPorts.length > 0 ? specPorts : DEFAULT_PORTS
    for (const port of ports) {
      out.push({ namespace: ns, service: name, port, image })
    }
  }

  // Move services with inference-hinting images to the front so the obvious
  // candidates get probed first (and appear first in the UI if the user is
  // watching a streaming response — though the current API returns one shot).
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
  // 1) Authoritative: data[0].owned_by reports the runtime by name
  const ownedBy = String(modelsJson?.data?.[0]?.owned_by ?? '').toLowerCase()
  if (ownedBy === 'vllm') return 'vllm'
  if (ownedBy === 'llamacpp' || ownedBy === 'llama.cpp') return 'llama.cpp'
  if (ownedBy === 'tgi' || ownedBy === 'huggingface') return 'tgi'
  if (ownedBy === 'ollama') return 'ollama'
  if (ownedBy === 'sglang') return 'sglang'

  // 2) Server header
  const server = headers.get('server') || ''
  if (/vllm/i.test(server)) return 'vllm'
  if (/text-generation-inference/i.test(server) || /TGI/.test(server)) return 'tgi'
  if (/ollama/i.test(server)) return 'ollama'
  if (/llama[. _-]?cpp/i.test(server) || /llama-server/i.test(server)) return 'llama.cpp'

  // 3) Container image hint (llama-server is what llama.cpp's HTTP server is called)
  if (image) {
    if (/vllm/i.test(image)) return 'vllm'
    if (/text-generation-inference|tgi/i.test(image)) return 'tgi'
    if (/llama[._ -]?cpp/i.test(image) || /llama-?server/i.test(image)) return 'llama.cpp'
    if (/ollama/i.test(image)) return 'ollama'
    if (/sglang/i.test(image)) return 'sglang'
    if (/triton/i.test(image)) return 'triton'
    if (/infinity/i.test(image)) return 'infinity'
  }

  // 4) Last-resort JSON shape heuristic
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

    // OpenAI-compatible shape: { object: "list", data: [{id: "...", object: "model"}] }
    let models: string[] = []
    if (Array.isArray(body?.data)) {
      models = body.data
        .map((m: any) => m?.id)
        .filter((id: any): id is string => typeof id === 'string')
    }
    if (models.length === 0) return null  // Not an OpenAI-compat /v1/models response

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
    return null  // Connection refused / timeout / not an HTTP server — silent skip
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

    // Probe in bounded parallel batches — too many in flight overwhelms the
    // event loop's DNS resolver on Bun and Service mesh sidecars get angry.
    const BATCH = 16
    const results: LLMEndpoint[] = []
    for (let i = 0; i < candidates.length; i += BATCH) {
      const slice = candidates.slice(i, i + BATCH)
      const settled = await Promise.all(slice.map(probe))
      for (const r of settled) if (r) results.push(r)
    }

    // De-dupe: a single workload often exposes the same models on multiple
    // service objects (headless + clusterIP). Keep the lowest-latency entry.
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
