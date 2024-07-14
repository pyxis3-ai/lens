<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import type { Pod } from '../lib/types'
import { timeAgo, formatBytes, podSymbol, podColor } from '../lib/formatters'
import { namespaceFilter } from '../lib/ws'
import LogViewer from './LogViewer.vue'
import ExecTerminal from './ExecTerminal.vue'

const props = defineProps<{ pods: Pod[]; compact?: boolean; focusedIndex?: number }>()
const filter = ref('')
const expandedPod = ref<string | null>(null)
const selectedPod = ref<string | null>(null)
const logPanelEl = ref<HTMLElement | null>(null)
const drillMode = ref<'logs' | 'exec'>('logs')
const execContainer = ref('')
const sortField = ref<'namespace' | 'cpu' | 'memory' | 'restarts' | 'name'>('namespace')
const sortDesc = ref(false)

function toggleSort(field: typeof sortField.value) {
  if (sortField.value === field) sortDesc.value = !sortDesc.value
  else { sortField.value = field; sortDesc.value = true }
}

async function deletePod(pod: Pod) {
  if (!confirm(`Delete ${pod.namespace}/${pod.name}?`)) return
  await fetch('/api/pod/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: pod.namespace, name: pod.name }) })
}

async function restartDeploy(pod: Pod) {
  // ownerKind is typically ReplicaSet for Deployments — strip the RS hash suffix
  let deployName = pod.ownerKind === 'ReplicaSet' ? pod.ownerName.replace(/-[a-f0-9]+$/, '') : pod.ownerName || pod.name.replace(/-[a-z0-9]+-[a-z0-9]+$/, '').replace(/-[a-z0-9]+$/, '')
  if (!deployName) { alert('Cannot determine deployment name'); return }
  if (!confirm(`Restart deployment ${pod.namespace}/${deployName}?`)) return
  await fetch('/api/deployment/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: pod.namespace, name: deployName }) })
}

function cpuNum(cpu: string | null): number {
  if (!cpu) return 0
  return cpu.endsWith('m') ? parseFloat(cpu) : parseFloat(cpu) * 1000
}

function podKey(pod: Pod) { return `${pod.namespace}/${pod.name}` }

function selectByKey(key: string) {
  const pod = props.pods.find(p => podKey(p) === key)
  if (pod) selectRow(pod)
}

defineExpose({ selectByKey })

function selectRow(pod: Pod) {
  const key = podKey(pod)
  if (selectedPod.value === key) {
    selectedPod.value = null
  } else {
    selectedPod.value = key
    drillMode.value = 'logs'
    execContainer.value = pod.containers[0]?.name || ''
    nextTick(() => logPanelEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }))
  }
}

function selectedNs(key: string) { return key.split('/')[0] }
function selectedName(key: string) { return key.split('/')[1] }
function containerNames(key: string): string[] {
  return props.pods.find(p => podKey(p) === key)?.containers?.map(c => c.name) || []
}

function pctOfReq(pod: Pod, type: 'cpu' | 'mem'): string {
  if (type === 'cpu') {
    const used = cpuNum(pod.cpu)
    const req = pod.containers.reduce((s, c) => s + cpuNum(c.requests.cpu), 0)
    return req > 0 ? `${Math.round(used / req * 100)}` : '-'
  }
  const used = pod.memory || 0
  const req = pod.containers.reduce((s, c) => s + (c.requests.memory || 0), 0)
  return req > 0 ? `${Math.round(used / req * 100)}` : '-'
}

function pctColor(val: string): string {
  const n = parseInt(val)
  if (isNaN(n)) return 'text-zinc-600'
  if (n > 90) return 'text-red-400'
  if (n > 70) return 'text-amber-400'
  return 'text-zinc-500'
}

function cpuDisplay(pod: Pod): string {
  if (pod.cpu !== null) return pod.cpu
  const totalReq = pod.containers.reduce((s, c) => s + cpuNum(c.requests.cpu), 0)
  return totalReq > 0 ? `~${totalReq.toFixed(0)}m` : '-'
}

function memDisplay(pod: Pod): string {
  if (pod.memory !== null && pod.memory > 0) return formatBytes(pod.memory)
  const totalReq = pod.containers.reduce((s, c) => s + (c.requests.memory || 0), 0)
  return totalReq > 0 ? `~${formatBytes(totalReq)}` : '-'
}

const sorted = computed(() => {
  let list = [...props.pods]
  if (namespaceFilter.value) list = list.filter(p => p.namespace === namespaceFilter.value)
  if (filter.value) {
    const q = filter.value.toLowerCase()
    list = list.filter(p => p.name.includes(q) || p.namespace.includes(q))
  }
  list.sort((a, b) => {
    if (a.status !== 'Running' && b.status === 'Running') return -1
    if (a.status === 'Running' && b.status !== 'Running') return 1
    let cmp = 0
    if (sortField.value === 'cpu') cmp = cpuNum(a.cpu) - cpuNum(b.cpu)
    else if (sortField.value === 'memory') cmp = (a.memory || 0) - (b.memory || 0)
    else if (sortField.value === 'restarts') cmp = a.restarts - b.restarts
    else if (sortField.value === 'name') cmp = a.name.localeCompare(b.name)
    else cmp = a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name)
    return sortDesc.value ? -cmp : cmp
  })
  return list
})

const display = computed(() => props.compact ? sorted.value.slice(0, 20) : sorted.value)
const colCount = computed(() => props.compact ? 12 : 13)

function isFocused(idx: number): boolean { return props.focusedIndex === idx }

watch(() => props.focusedIndex, async (idx) => {
  if (idx === undefined || idx < 0) return
  await nextTick()
  document.querySelectorAll('[data-pod-row]')[idx]?.scrollIntoView({ block: 'nearest' })
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && selectedPod.value) { selectedPod.value = null; e.stopPropagation(); return }
  if (e.key === 'x' && props.focusedIndex !== undefined && props.focusedIndex >= 0) {
    const pod = display.value[props.focusedIndex]
    if (pod) { const key = podKey(pod); expandedPod.value = expandedPod.value === key ? null : key }
    return
  }
  if (e.key === 'e' && selectedPod.value && !(e.target as HTMLElement).closest('.xterm')) {
    drillMode.value = drillMode.value === 'exec' ? 'logs' : 'exec'
  }
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div>
    <div class="flex items-center gap-3 mb-1">
      <span class="text-xs text-zinc-500">PODS {{ sorted.length }}</span>
      <span v-if="pods.length && !pods[0]?.metricsAvailable" class="text-xs text-amber-500">\u26A0 no metrics</span>
      <input v-model="filter" placeholder="/" class="bg-transparent border-b border-zinc-700 text-xs px-1 py-0.5 text-zinc-300 outline-none w-32" />
      <span class="text-zinc-700 text-xs">j/k:nav enter:open x:expand [/]:sub-tab r:refresh</span>
    </div>

    <div class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-zinc-600 border-b border-zinc-800 select-none">
            <th class="text-left px-2 py-1 w-4"></th>
            <th class="text-left px-2 py-1 cursor-pointer hover:text-zinc-400" @click="toggleSort('namespace')">NS</th>
            <th class="text-left px-2 py-1 cursor-pointer hover:text-zinc-400" @click="toggleSort('name')">NAME</th>
            <th class="text-center px-2 py-1">RDY</th>
            <th class="text-left px-2 py-1">STATUS</th>
            <th class="text-right px-2 py-1 cursor-pointer hover:text-zinc-400" @click="toggleSort('restarts')">\u21BB</th>
            <th class="text-right px-2 py-1 cursor-pointer hover:text-zinc-400" @click="toggleSort('cpu')">CPU</th>
            <th class="text-right px-2 py-1">%R</th>
            <th class="text-right px-2 py-1 cursor-pointer hover:text-zinc-400" @click="toggleSort('memory')">MEM</th>
            <th class="text-right px-2 py-1">%R</th>
            <th class="text-left px-2 py-1">IP</th>
            <th class="text-right px-2 py-1">AGE</th>
            <th v-if="!compact" class="text-right px-2 py-1">ACT</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(pod, idx) in display" :key="podKey(pod)">
            <tr @click="selectRow(pod)" data-pod-row
              class="border-b border-zinc-800/30 cursor-pointer transition-colors"
              :class="[
                selectedPod === podKey(pod) ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : '',
                isFocused(idx) && selectedPod !== podKey(pod) ? 'bg-zinc-800/30 border-l-2 border-l-zinc-600' : '',
                selectedPod !== podKey(pod) && !isFocused(idx) ? 'row-hover' : '',
              ]">
              <td class="px-2 py-0.5" :class="podColor(pod.status, pod.ready)">{{ podSymbol(pod.status, pod.ready) }}</td>
              <td class="px-2 py-0.5 text-zinc-500 truncate">{{ pod.namespace }}</td>
              <td class="px-2 py-0.5 text-zinc-300 truncate">
                {{ pod.name }}
                <button v-if="pod.containers.length > 1" @click.stop="expandedPod = expandedPod === podKey(pod) ? null : podKey(pod)"
                  class="ml-1 text-zinc-600 hover:text-zinc-400">
                  {{ expandedPod === podKey(pod) ? '\u25BE' : '\u25B8' }}{{ pod.containers.length }}
                </button>
              </td>
              <td class="px-2 py-0.5 text-center" :class="pod.readyCount === pod.totalCount ? 'text-emerald-400' : 'text-amber-400'">{{ pod.readyCount }}/{{ pod.totalCount }}</td>
              <td class="px-2 py-0.5" :class="podColor(pod.status, pod.ready)">{{ pod.status }}</td>
              <td class="px-2 py-0.5 text-right" :class="pod.restarts > 0 ? 'text-amber-400' : 'text-zinc-600'">{{ pod.restarts }}</td>
              <td class="px-2 py-0.5 text-right" :class="[cpuNum(pod.cpu) > 500 ? 'text-amber-400' : 'text-zinc-500', pod.cpu === null ? 'italic' : '']">{{ cpuDisplay(pod) }}</td>
              <td class="px-2 py-0.5 text-right" :class="pctColor(pctOfReq(pod, 'cpu'))">{{ pctOfReq(pod, 'cpu') }}</td>
              <td class="px-2 py-0.5 text-right" :class="[(pod.memory || 0) > 1073741824 ? 'text-amber-400' : 'text-zinc-500', pod.memory === null ? 'italic' : '']">{{ memDisplay(pod) }}</td>
              <td class="px-2 py-0.5 text-right" :class="pctColor(pctOfReq(pod, 'mem'))">{{ pctOfReq(pod, 'mem') }}</td>
              <td class="px-2 py-0.5 text-zinc-600">{{ pod.ip }}</td>
              <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(pod.age) }}</td>
              <td v-if="!compact" class="px-2 py-0.5 text-right">
                <button @click.stop="deletePod(pod)" class="text-zinc-600 hover:text-red-400 mr-1" title="Delete">\u2715</button>
                <button @click.stop="restartDeploy(pod)" class="text-zinc-600 hover:text-amber-400" title="Restart">\u21BB</button>
              </td>
            </tr>
            <!-- Container expansion -->
            <tr v-if="expandedPod === podKey(pod)" class="bg-zinc-900/30">
              <td :colspan="colCount" class="px-4 py-1">
                <div class="text-xs space-y-0.5">
                  <div v-for="c in pod.containers" :key="c.name" class="flex items-center gap-3">
                    <span :class="c.ready ? 'text-emerald-400' : 'text-red-400'">{{ c.ready ? '\u25CF' : '\u25CB' }}</span>
                    <span class="text-zinc-400 w-32 truncate">{{ c.name }}</span>
                    <span class="text-zinc-500 w-14 text-right">{{ c.cpu !== null ? `${c.cpu.toFixed(1)}m` : (c.requests.cpu || '-') }}</span>
                    <span class="text-zinc-500 w-16 text-right">{{ c.memory !== null ? formatBytes(c.memory) : (c.requests.memory ? formatBytes(c.requests.memory) : '-') }}</span>
                    <span class="text-zinc-600 w-6 text-right">\u21BB{{ c.restarts }}</span>
                    <span class="text-zinc-600">{{ c.state }}</span>
                    <span v-if="c.limits.memory" class="text-zinc-700">lim:{{ formatBytes(c.limits.memory) }}</span>
                    <span class="text-zinc-700 truncate">{{ c.image }}</span>
                  </div>
                </div>
              </td>
            </tr>
            <!-- Log/exec inline expansion -->
            <tr v-if="selectedPod === podKey(pod)" ref="logPanelEl" class="bg-emerald-900/10">
              <td :colspan="colCount" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center gap-2">
                  <div class="flex gap-0.5">
                    <button @click.stop="drillMode = 'logs'"
                      :class="drillMode === 'logs' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
                      class="px-1.5 py-0 rounded text-xs">logs</button>
                    <button @click.stop="drillMode = 'exec'"
                      :class="drillMode === 'exec' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
                      class="px-1.5 py-0 rounded text-xs">exec</button>
                  </div>
                  <select v-if="drillMode === 'exec' && containerNames(selectedPod).length > 1"
                    v-model="execContainer" @click.stop
                    class="bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded px-1 py-0">
                    <option v-for="c in containerNames(selectedPod)" :key="c" :value="c">{{ c }}</option>
                  </select>
                  <span class="text-zinc-600 ml-auto text-xs">e:toggle esc</span>
                  <button @click.stop="selectedPod = null" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button>
                </div>
                <div class="overflow-auto max-h-96">
                  <LogViewer v-if="drillMode === 'logs'" :namespace="selectedNs(selectedPod)" :pod="selectedName(selectedPod)" />
                  <ExecTerminal v-else-if="drillMode === 'exec' && execContainer" :namespace="selectedNs(selectedPod)" :pod="selectedName(selectedPod)" :container="execContainer" />
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

  </div>
</template>
