<script setup lang="ts">
import { ref, computed, watch, nextTick, onUnmounted } from 'vue'
import { logLineColor } from '../lib/formatters'

const props = defineProps<{ namespace: string; pod: string }>()
const lines = ref<string[]>([])
const loading = ref(true)
const autoScroll = ref(true)
const searchQuery = ref('')
const logEl = ref<HTMLElement | null>(null)
let interval: ReturnType<typeof setInterval> | null = null

async function fetchLogs() {
  try {
    const res = await fetch(`/api/logs?namespace=${encodeURIComponent(props.namespace)}&pod=${encodeURIComponent(props.pod)}&tail=300`)
    const data = await res.json()
    lines.value = data.lines || []
    loading.value = false
    if (autoScroll.value) {
      await nextTick()
      scrollToBottom()
    }
  } catch {
    lines.value = ['Error fetching logs']
    loading.value = false
  }
}

function scrollToBottom() {
  if (!logEl.value) return
  // Scroll the nearest scrollable ancestor (parent has overflow-auto max-h-96)
  const scrollParent = logEl.value.closest('.overflow-auto') || logEl.value.parentElement
  if (scrollParent) scrollParent.scrollTop = scrollParent.scrollHeight
}

function startPolling() {
  fetchLogs()
  interval = setInterval(fetchLogs, 3000)
}

function stopPolling() {
  if (interval) clearInterval(interval)
}

const filteredLines = computed(() => {
  if (!searchQuery.value) return lines.value
  const q = searchQuery.value.toLowerCase()
  return lines.value.filter(l => l.toLowerCase().includes(q))
})

// Escape HTML to prevent XSS from log content
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function highlightLine(line: string): string {
  const safe = escapeHtml(line)
  if (!searchQuery.value) return safe
  try {
    const escapedQuery = escapeHtml(searchQuery.value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return safe.replace(new RegExp(`(${escapedQuery})`, 'gi'), '<mark class="bg-amber-500/30 text-amber-200">$1</mark>')
  } catch { return safe }
}

watch(() => `${props.namespace}/${props.pod}`, () => {
  loading.value = true
  lines.value = []
  searchQuery.value = ''
  stopPolling()
  startPolling()
}, { immediate: true })

onUnmounted(stopPolling)
</script>

<template>
  <div>
    <div class="flex items-center gap-2 px-3 py-1 text-xs text-zinc-500 border-b border-zinc-800/50">
      <span>logs</span>
      <span class="text-zinc-600">{{ searchQuery ? `${filteredLines.length}/` : '' }}{{ lines.length }}</span>
      <input v-model="searchQuery" placeholder="grep..." class="bg-transparent border-b border-zinc-700 text-xs px-1 py-0 text-zinc-300 outline-none w-24 sm:w-32" />
      <label class="ml-auto flex items-center gap-1 cursor-pointer shrink-0">
        <input type="checkbox" v-model="autoScroll" class="accent-emerald-500" />
        <span>auto-scroll</span>
      </label>
    </div>
    <div v-if="loading" class="p-4 text-zinc-600 text-xs animate-pulse">loading...</div>
    <div v-else ref="logEl" class="p-2 bg-zinc-950">
      <pre class="text-xs leading-relaxed whitespace-pre-wrap"><template v-for="(line, i) in filteredLines" :key="i"><span :class="logLineColor(line)" v-html="highlightLine(line)"></span>
</template></pre>
      <div v-if="searchQuery && filteredLines.length === 0" class="text-zinc-600 mt-2">no matches for "{{ searchQuery }}"</div>
    </div>
  </div>
</template>
