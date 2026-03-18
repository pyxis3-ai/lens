<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { pods, deployments, statefulsets, pvcs, ingresses, k8sServices, daemonsets, replicasets, cronjobs, jobs, configmaps, secrets, loadResources, namespaceFilter } from '../lib/ws'
import { timeAgo } from '../lib/formatters'
import PodsPanel from './PodsPanel.vue'

type ResourceType = 'pods' | 'deploy' | 'sts' | 'ds' | 'rs' | 'svc' | 'cm' | 'sec' | 'pvc' | 'ing' | 'cj' | 'job'
const active = ref<ResourceType>('pods')
const describeData = ref<any>(null)
const describeKey = ref('')
const describeLoading = ref(false)

defineProps<{ focusedPodIndex?: number }>()

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && describeData.value) { describeData.value = null; describeKey.value = ''; e.stopPropagation() }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

async function scale(ns: string, name: string) {
  const r = prompt(`Scale ${name} to how many replicas?`)
  if (r === null) return
  const replicas = parseInt(r)
  if (isNaN(replicas) || replicas < 0) return
  await fetch('/api/deployment/scale', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: ns, name, replicas }) })
  setTimeout(loadResources, 2000)
}

async function restart(ns: string, name: string) {
  if (!confirm(`Restart ${ns}/${name}?`)) return
  await fetch('/api/deployment/restart', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ namespace: ns, name }) })
}

async function describe(kind: string, ns: string, name: string) {
  const key = `${ns}/${name}`
  if (describeKey.value === key) { describeData.value = null; describeKey.value = ''; return }
  describeKey.value = key
  describeLoading.value = true
  try {
    const res = await fetch(`/api/describe?kind=${kind}&namespace=${encodeURIComponent(ns)}&name=${encodeURIComponent(name)}`)
    describeData.value = await res.json()
  } catch { describeData.value = { error: 'failed to fetch' } }
  describeLoading.value = false
}

function nsFilter<T extends { namespace: string }>(items: T[]): T[] {
  return namespaceFilter.value ? items.filter(i => i.namespace === namespaceFilter.value) : items
}

const filtered = computed(() => ({
  deploy: nsFilter(deployments.value),
  sts: nsFilter(statefulsets.value),
  ds: nsFilter(daemonsets.value),
  rs: nsFilter(replicasets.value),
  svc: nsFilter(k8sServices.value),
  cm: nsFilter(configmaps.value),
  sec: nsFilter(secrets.value),
  pvc: nsFilter(pvcs.value),
  ing: nsFilter(ingresses.value),
  cj: nsFilter(cronjobs.value),
  job: nsFilter(jobs.value),
}))

const RESOURCE_TYPES: ResourceType[] = ['pods', 'deploy', 'sts', 'ds', 'rs', 'svc', 'cm', 'sec', 'pvc', 'ing', 'cj', 'job']

function cycleTab(dir: number) {
  const idx = RESOURCE_TYPES.indexOf(active.value)
  active.value = RESOURCE_TYPES[(idx + dir + RESOURCE_TYPES.length) % RESOURCE_TYPES.length]
  describeData.value = null
  describeKey.value = ''
}

function isPodsActive() { return active.value === 'pods' }

const podsRef = ref<any>(null)
function selectPodByKey(key: string) { podsRef.value?.selectByKey?.(key) }

defineExpose({ cycleTab, isPodsActive, selectPodByKey })

const tabs: { key: ResourceType; label: string; count: () => number }[] = [
  { key: 'pods', label: 'pods', count: () => pods.value.length },
  { key: 'deploy', label: 'deploy', count: () => filtered.value.deploy.length },
  { key: 'sts', label: 'sts', count: () => filtered.value.sts.length },
  { key: 'ds', label: 'ds', count: () => filtered.value.ds.length },
  { key: 'rs', label: 'rs', count: () => filtered.value.rs.length },
  { key: 'svc', label: 'svc', count: () => filtered.value.svc.length },
  { key: 'cm', label: 'cm', count: () => filtered.value.cm.length },
  { key: 'sec', label: 'sec', count: () => filtered.value.sec.length },
  { key: 'pvc', label: 'pvc', count: () => filtered.value.pvc.length },
  { key: 'ing', label: 'ing', count: () => filtered.value.ing.length },
  { key: 'cj', label: 'cj', count: () => filtered.value.cj.length },
  { key: 'job', label: 'job', count: () => filtered.value.job.length },
]
</script>

<template>
  <div>
    <div class="flex items-center gap-1 mb-2 flex-wrap">
      <button v-for="t in tabs" :key="t.key"
        @click="active = t.key; describeData = null"
        :class="active === t.key ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
        class="px-1.5 py-0.5 text-xs rounded transition-colors">
        {{ t.label }}<span class="text-zinc-600 ml-0.5">{{ t.count() }}</span>
      </button>
      <button @click="loadResources" class="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">\u21BB</button>
    </div>

    <!-- Pods -->
    <PodsPanel v-if="active === 'pods'" ref="podsRef" :pods="pods" :focusedIndex="focusedPodIndex" />

    <!-- Deployments -->
    <div v-else-if="active === 'deploy'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">READY</th><th class="text-right px-2 py-1">UP-TO-DATE</th>
          <th class="text-right px-2 py-1">AVAILABLE</th><th class="text-right px-2 py-1">AGE</th>
          <th class="text-left px-2 py-1">IMAGE</th><th class="text-right px-2 py-1">ACT</th>
        </tr></thead>
        <tbody>
          <template v-for="d in filtered.deploy" :key="`${d.namespace}/${d.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${d.namespace}/${d.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('deployment', d.namespace, d.name)">
              <td class="px-2 py-0.5 text-zinc-500">{{ d.namespace }}</td>
              <td class="px-2 py-0.5 text-zinc-300">{{ d.name }}</td>
              <td class="px-2 py-0.5 text-right" :class="d.ready === d.replicas ? 'text-emerald-400' : 'text-amber-400'">{{ d.ready }}/{{ d.replicas }}</td>
              <td class="px-2 py-0.5 text-right text-zinc-400">{{ d.upToDate }}</td>
              <td class="px-2 py-0.5 text-right text-zinc-400">{{ d.available }}</td>
              <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(d.age) }}</td>
              <td class="px-2 py-0.5 text-zinc-600 max-w-48 truncate">{{ d.image }}</td>
              <td class="px-2 py-0.5 text-right" @click.stop>
                <button @click="scale(d.namespace, d.name)" class="text-zinc-600 hover:text-blue-400 mr-1" title="Scale">\u21D5</button>
                <button @click="restart(d.namespace, d.name)" class="text-zinc-600 hover:text-amber-400" title="Restart">\u21BB</button>
              </td>
            </tr>
            <tr v-if="describeKey === `${d.namespace}/${d.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- StatefulSets -->
    <div v-else-if="active === 'sts'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">READY</th><th class="text-right px-2 py-1">AGE</th>
          <th class="text-left px-2 py-1">IMAGE</th>
        </tr></thead>
        <tbody>
          <template v-for="s in filtered.sts" :key="`${s.namespace}/${s.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${s.namespace}/${s.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('statefulset', s.namespace, s.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ s.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ s.name }}</td>
            <td class="px-2 py-0.5 text-right" :class="s.ready === s.replicas ? 'text-emerald-400' : 'text-amber-400'">{{ s.ready }}/{{ s.replicas }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(s.age) }}</td>
            <td class="px-2 py-0.5 text-zinc-600 max-w-48 truncate">{{ s.image }}</td>
          </tr>
            <tr v-if="describeKey === `${s.namespace}/${s.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- DaemonSets -->
    <div v-else-if="active === 'ds'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">DESIRED</th><th class="text-right px-2 py-1">READY</th>
          <th class="text-right px-2 py-1">UP-TO-DATE</th><th class="text-right px-2 py-1">AVAILABLE</th>
          <th class="text-right px-2 py-1">AGE</th><th class="text-left px-2 py-1">IMAGE</th>
        </tr></thead>
        <tbody>
          <template v-for="d in filtered.ds" :key="`${d.namespace}/${d.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${d.namespace}/${d.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('daemonset', d.namespace, d.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ d.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ d.name }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ d.desired }}</td>
            <td class="px-2 py-0.5 text-right" :class="d.ready === d.desired ? 'text-emerald-400' : 'text-amber-400'">{{ d.ready }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ d.upToDate }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ d.available }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(d.age) }}</td>
            <td class="px-2 py-0.5 text-zinc-600 max-w-48 truncate">{{ d.image }}</td>
          </tr>
            <tr v-if="describeKey === `${d.namespace}/${d.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- ReplicaSets -->
    <div v-else-if="active === 'rs'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">DESIRED</th><th class="text-right px-2 py-1">READY</th>
          <th class="text-right px-2 py-1">AVAILABLE</th><th class="text-left px-2 py-1">OWNER</th>
          <th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <tr v-for="r in filtered.rs" :key="`${r.namespace}/${r.name}`" class="row-hover border-b border-zinc-800/30">
            <td class="px-2 py-0.5 text-zinc-500">{{ r.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ r.name }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ r.desired }}</td>
            <td class="px-2 py-0.5 text-right" :class="r.ready === r.desired ? 'text-emerald-400' : 'text-amber-400'">{{ r.ready }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ r.available }}</td>
            <td class="px-2 py-0.5 text-zinc-600">{{ r.owner }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(r.age) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Services -->
    <div v-else-if="active === 'svc'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-left px-2 py-1">TYPE</th><th class="text-left px-2 py-1">CLUSTER-IP</th>
          <th class="text-left px-2 py-1">EXTERNAL-IP</th>
          <th class="text-left px-2 py-1">PORT(S)</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="s in filtered.svc" :key="`${s.namespace}/${s.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${s.namespace}/${s.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('service', s.namespace, s.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ s.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ s.name }}</td>
            <td class="px-2 py-0.5 text-zinc-400">{{ s.type }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ s.clusterIP }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ s.externalIP || '-' }}</td>
            <td class="px-2 py-0.5 text-zinc-400 max-w-48 truncate">{{ s.ports }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(s.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${s.namespace}/${s.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- ConfigMaps -->
    <div v-else-if="active === 'cm'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">KEYS</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="c in filtered.cm" :key="`${c.namespace}/${c.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${c.namespace}/${c.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('configmap', c.namespace, c.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ c.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ c.name }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ c.keys }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(c.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${c.namespace}/${c.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Secrets -->
    <div v-else-if="active === 'sec'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-left px-2 py-1">TYPE</th>
          <th class="text-right px-2 py-1">KEYS</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="s in filtered.sec" :key="`${s.namespace}/${s.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${s.namespace}/${s.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('secret', s.namespace, s.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ s.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ s.name }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ s.type }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ s.keys }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(s.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${s.namespace}/${s.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- PVCs -->
    <div v-else-if="active === 'pvc'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-left px-2 py-1">STATUS</th><th class="text-left px-2 py-1">VOLUME</th>
          <th class="text-right px-2 py-1">CAPACITY</th><th class="text-left px-2 py-1">ACCESS</th>
          <th class="text-left px-2 py-1">CLASS</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="p in filtered.pvc" :key="`${p.namespace}/${p.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${p.namespace}/${p.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('pvc', p.namespace, p.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ p.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ p.name }}</td>
            <td class="px-2 py-0.5" :class="p.status === 'Bound' ? 'text-emerald-400' : 'text-amber-400'">{{ p.status }}</td>
            <td class="px-2 py-0.5 text-zinc-600 max-w-32 truncate">{{ p.volume }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ p.capacity }}</td>
            <td class="px-2 py-0.5 text-zinc-600">{{ p.accessModes?.join(', ') }}</td>
            <td class="px-2 py-0.5 text-zinc-600">{{ p.storageClass }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(p.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${p.namespace}/${p.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Ingresses -->
    <div v-else-if="active === 'ing'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-left px-2 py-1">CLASS</th><th class="text-left px-2 py-1">HOSTS</th>
          <th class="text-left px-2 py-1">ADDRESS</th>
          <th class="text-left px-2 py-1">TLS</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="i in filtered.ing" :key="`${i.namespace}/${i.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${i.namespace}/${i.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('ingress', i.namespace, i.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ i.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ i.name }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ i.class }}</td>
            <td class="px-2 py-0.5 text-zinc-400 max-w-48 truncate">{{ i.hosts.join(', ') }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ i.address || '-' }}</td>
            <td class="px-2 py-0.5" :class="i.tls ? 'text-emerald-400' : 'text-zinc-600'">{{ i.tls ? '\uD83D\uDD12' : '-' }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(i.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${i.namespace}/${i.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- CronJobs -->
    <div v-else-if="active === 'cj'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-left px-2 py-1">SCHEDULE</th><th class="text-left px-2 py-1">SUSPEND</th>
          <th class="text-right px-2 py-1">ACTIVE</th><th class="text-right px-2 py-1">LAST</th>
          <th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="c in filtered.cj" :key="`${c.namespace}/${c.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${c.namespace}/${c.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('cronjob', c.namespace, c.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ c.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ c.name }}</td>
            <td class="px-2 py-0.5 text-zinc-400">{{ c.schedule }}</td>
            <td class="px-2 py-0.5" :class="c.suspend ? 'text-amber-400' : 'text-zinc-600'">{{ c.suspend }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ c.active }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ c.lastSchedule ? timeAgo(c.lastSchedule) : '-' }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(c.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${c.namespace}/${c.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <!-- Jobs -->
    <div v-else-if="active === 'job'" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead><tr class="text-zinc-600 border-b border-zinc-800">
          <th class="text-left px-2 py-1">NS</th><th class="text-left px-2 py-1">NAME</th>
          <th class="text-right px-2 py-1">COMPLETIONS</th><th class="text-left px-2 py-1">STATUS</th>
          <th class="text-right px-2 py-1">DURATION</th><th class="text-right px-2 py-1">AGE</th>
        </tr></thead>
        <tbody>
          <template v-for="j in filtered.job" :key="`${j.namespace}/${j.name}`">
            <tr class="border-b border-zinc-800/30 cursor-pointer" :class="describeKey === `${j.namespace}/${j.name}` ? 'bg-emerald-900/20 border-l-2 border-l-emerald-500' : 'row-hover'" @click="describe('job', j.namespace, j.name)">
            <td class="px-2 py-0.5 text-zinc-500">{{ j.namespace }}</td>
            <td class="px-2 py-0.5 text-zinc-300">{{ j.name }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-400">{{ j.completions }}</td>
            <td class="px-2 py-0.5" :class="j.status === 'Complete' ? 'text-emerald-400' : j.status === 'Failed' ? 'text-red-400' : 'text-amber-400'">{{ j.status }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ j.duration !== null ? j.duration + 's' : '-' }}</td>
            <td class="px-2 py-0.5 text-right text-zinc-600">{{ timeAgo(j.age) }}</td>
          </tr>
            <tr v-if="describeKey === `${j.namespace}/${j.name}` && describeData" class="bg-emerald-900/10">
              <td colspan="20" class="p-0">
                <div class="px-3 py-1 text-xs bg-zinc-900/80 border-b border-zinc-800/50 flex items-center justify-between">
                  <span class="text-emerald-400">describe</span>
                  <span class="text-zinc-600">esc <button @click.stop="describeData = null; describeKey = ''" class="text-zinc-500 hover:text-zinc-300 ml-1">\u2715</button></span>
                </div>
                <div class="overflow-auto max-h-96 p-2">
                  <pre v-if="describeLoading" class="text-xs text-zinc-600 animate-pulse">loading...</pre>
                  <pre v-else class="text-xs text-zinc-400 whitespace-pre-wrap">{{ JSON.stringify(describeData, null, 2) }}</pre>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
  </div>
</template>
