<script setup lang="ts">
import { onMounted, computed } from 'vue'
import { llmEndpoints, llmLoading, llmError, loadLLM, namespaceFilter } from '../lib/ws'

onMounted(() => { if (llmEndpoints.value.length === 0) loadLLM() })

const filtered = computed(() =>
  namespaceFilter.value
    ? llmEndpoints.value.filter(e => e.namespace === namespaceFilter.value)
    : llmEndpoints.value,
)

const totalModels = computed(() =>
  new Set(filtered.value.flatMap(e => e.models)).size,
)

function runtimeColor(rt: string): string {
  if (rt === 'vllm') return 'text-emerald-400'
  if (rt === 'tgi') return 'text-amber-400'
  if (rt === 'llama.cpp') return 'text-orange-400'
  if (rt === 'ollama') return 'text-blue-400'
  if (rt === 'sglang') return 'text-fuchsia-400'
  if (rt === 'triton') return 'text-cyan-400'
  return 'text-zinc-500'
}

function latencyColor(ms: number): string {
  if (ms < 50) return 'text-emerald-400'
  if (ms < 200) return 'text-amber-400'
  return 'text-red-400'
}
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-2 text-xs">
      <span class="text-zinc-500">
        <span class="text-zinc-300">{{ filtered.length }}</span> endpoint{{ filtered.length === 1 ? '' : 's' }}
        · <span class="text-zinc-300">{{ totalModels }}</span> model{{ totalModels === 1 ? '' : 's' }}
      </span>
      <span v-if="llmLoading" class="text-zinc-600 animate-pulse">scanning…</span>
      <span v-if="llmError" class="text-red-400">{{ llmError }}</span>
      <button @click="loadLLM(true)"
        class="ml-auto text-zinc-600 hover:text-emerald-400"
        title="Force re-scan (bypass 30s cache)">
        ↻ rescan
      </button>
    </div>

    <div v-if="filtered.length === 0 && !llmLoading" class="text-xs text-zinc-600 py-3 px-2 italic">
      No OpenAI-compatible inference endpoints discovered. lens probes every cluster Service on
      its declared TCP ports for <code class="text-zinc-500">/v1/models</code> — deploy vLLM /
      TGI / llama.cpp / Ollama and they'll appear here.
    </div>

    <div v-else class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-zinc-600 border-b border-zinc-800">
            <th class="text-left  px-2 py-1">NS</th>
            <th class="text-left  px-2 py-1">SERVICE</th>
            <th class="text-right px-2 py-1">PORT</th>
            <th class="text-left  px-2 py-1">RUNTIME</th>
            <th class="text-left  px-2 py-1">MODELS</th>
            <th class="text-right px-2 py-1">LATENCY</th>
            <th class="text-left  px-2 py-1">IMAGE</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in filtered"
              :key="`${e.namespace}/${e.service}:${e.port}`"
              class="row-hover border-b border-zinc-800/30">
            <td class="px-2 py-0.5 text-zinc-500">{{ e.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ e.service }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ e.port }}</td>
            <td class="px-2 py-0.5 font-medium" :class="runtimeColor(e.runtime)">{{ e.runtime }}</td>
            <td class="px-2 py-0.5 text-zinc-400 max-w-md">
              <span v-for="(m, idx) in e.models.slice(0, 3)" :key="m"
                    class="inline-block bg-zinc-800/60 px-1.5 py-0.5 rounded mr-1 text-zinc-300">
                {{ m }}<template v-if="idx === 2 && e.models.length > 3"></template>
              </span>
              <span v-if="e.models.length > 3" class="text-zinc-600">+{{ e.models.length - 3 }}</span>
            </td>
            <td class="px-2 py-0.5 text-right font-mono" :class="latencyColor(e.latencyMs)">{{ e.latencyMs }}ms</td>
            <td class="px-2 py-0.5 text-zinc-600 max-w-64 truncate" :title="e.servedBy">
              {{ e.servedBy || '—' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p class="text-xs text-zinc-700 mt-3 px-2">
      In-cluster probe of <code class="text-zinc-500">/v1/models</code> on every Service.
      Cached 30s. No tokens are spent — only the model-list endpoint is hit.
    </p>
  </div>
</template>
