<script setup lang="ts">
import { ref, computed } from 'vue'
import { pods, deployments, statefulsets, pvcs, ingresses, k8sServices, daemonsets, replicasets, cronjobs, jobs, configmaps, secrets, loadResources, namespaceFilter, llmEndpoints, postJson } from '../lib/ws'
import { timeAgo } from '../lib/formatters'
import type { ResourceCol } from '../lib/types'
import PodsPanel from './PodsPanel.vue'
import LLMPanel from './LLMPanel.vue'
import ResourceTable from './ResourceTable.vue'

type ResourceType = 'llm' | 'pods' | 'deploy' | 'sts' | 'ds' | 'rs' | 'svc' | 'cm' | 'sec' | 'pvc' | 'ing' | 'cj' | 'job'
const active = ref<ResourceType>('pods')

defineProps<{ focusedPodIndex?: number }>()

async function scale(ns: string, name: string) {
  const r = prompt(`Scale ${name} to how many replicas?`)
  if (r === null) return
  const replicas = parseInt(r)
  if (isNaN(replicas) || replicas < 0) return
  await postJson('/api/deployment/scale', { namespace: ns, name, replicas })
  setTimeout(loadResources, 2000)
}

async function restart(ns: string, name: string) {
  if (!confirm(`Restart ${ns}/${name}?`)) return
  await postJson('/api/deployment/restart', { namespace: ns, name })
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

const ns: ResourceCol = { h: 'NS', cls: 'text-zinc-500', val: r => r.namespace }
const nm: ResourceCol = { h: 'NAME', cls: 'text-zinc-300', val: r => r.name }
const age: ResourceCol = { h: 'AGE', r: true, cls: 'text-zinc-600', val: r => timeAgo(r.age) }
const img: ResourceCol = { h: 'IMAGE', cls: 'text-zinc-600 max-w-48 truncate', val: r => r.image }

const cols: Record<string, ResourceCol[]> = {
  deploy: [ns, nm,
    { h: 'READY', r: true, cls: r => r.ready === r.replicas ? 'text-emerald-400' : 'text-amber-400', val: r => `${r.ready}/${r.replicas}` },
    { h: 'UP-TO-DATE', r: true, val: r => r.upToDate }, { h: 'AVAILABLE', r: true, val: r => r.available }, age, img],
  sts: [ns, nm,
    { h: 'READY', r: true, cls: r => r.ready === r.replicas ? 'text-emerald-400' : 'text-amber-400', val: r => `${r.ready}/${r.replicas}` }, age, img],
  ds: [ns, nm, { h: 'DESIRED', r: true, val: r => r.desired },
    { h: 'READY', r: true, cls: r => r.ready === r.desired ? 'text-emerald-400' : 'text-amber-400', val: r => r.ready },
    { h: 'UP-TO-DATE', r: true, val: r => r.upToDate }, { h: 'AVAILABLE', r: true, val: r => r.available }, age, img],
  rs: [ns, nm, { h: 'DESIRED', r: true, val: r => r.desired },
    { h: 'READY', r: true, cls: r => r.ready === r.desired ? 'text-emerald-400' : 'text-amber-400', val: r => r.ready },
    { h: 'AVAILABLE', r: true, val: r => r.available }, { h: 'OWNER', cls: 'text-zinc-600', val: r => r.owner }, age],
  svc: [ns, nm, { h: 'TYPE', val: r => r.type }, { h: 'CLUSTER-IP', cls: 'text-zinc-500', val: r => r.clusterIP },
    { h: 'EXTERNAL-IP', cls: 'text-zinc-500', val: r => r.externalIP || '-' },
    { h: 'PORT(S)', cls: 'text-zinc-400 max-w-48 truncate', val: r => r.ports }, age],
  cm: [ns, nm, { h: 'KEYS', r: true, val: r => r.keys }, age],
  sec: [ns, nm, { h: 'TYPE', cls: 'text-zinc-500', val: r => r.type }, { h: 'KEYS', r: true, val: r => r.keys }, age],
  pvc: [ns, nm, { h: 'STATUS', cls: r => r.status === 'Bound' ? 'text-emerald-400' : 'text-amber-400', val: r => r.status },
    { h: 'VOLUME', cls: 'text-zinc-600 max-w-32 truncate', val: r => r.volume }, { h: 'CAPACITY', r: true, val: r => r.capacity },
    { h: 'ACCESS', cls: 'text-zinc-600', val: r => r.accessModes?.join(', ') }, { h: 'CLASS', cls: 'text-zinc-600', val: r => r.storageClass }, age],
  ing: [ns, nm, { h: 'CLASS', cls: 'text-zinc-500', val: r => r.class },
    { h: 'HOSTS', cls: 'text-zinc-400 max-w-48 truncate', val: r => r.hosts.join(', ') },
    { h: 'ADDRESS', cls: 'text-zinc-500', val: r => r.address || '-' },
    { h: 'TLS', cls: r => r.tls ? 'text-emerald-400' : 'text-zinc-600', val: r => r.tls ? '🔒' : '-' }, age],
  cj: [ns, nm, { h: 'SCHEDULE', val: r => r.schedule },
    { h: 'SUSPEND', cls: r => r.suspend ? 'text-amber-400' : 'text-zinc-600', val: r => r.suspend },
    { h: 'ACTIVE', r: true, val: r => r.active }, { h: 'LAST', r: true, cls: 'text-zinc-600', val: r => r.lastSchedule ? timeAgo(r.lastSchedule) : '-' }, age],
  job: [ns, nm, { h: 'COMPLETIONS', r: true, val: r => r.completions },
    { h: 'STATUS', cls: r => r.status === 'Complete' ? 'text-emerald-400' : r.status === 'Failed' ? 'text-red-400' : 'text-amber-400', val: r => r.status },
    { h: 'DURATION', r: true, cls: 'text-zinc-600', val: r => r.duration !== null ? r.duration + 's' : '-' }, age],
}

const kinds: Record<string, string> = { deploy: 'deployment', sts: 'statefulset', ds: 'daemonset', svc: 'service', cm: 'configmap', sec: 'secret', pvc: 'pvc', ing: 'ingress', cj: 'cronjob', job: 'job' }

function cycleTab(dir: number) {
  const idx = RESOURCE_TYPES.indexOf(active.value)
  active.value = RESOURCE_TYPES[(idx + dir + RESOURCE_TYPES.length) % RESOURCE_TYPES.length]
}
const RESOURCE_TYPES: ResourceType[] = ['llm', 'pods', 'deploy', 'sts', 'ds', 'rs', 'svc', 'cm', 'sec', 'pvc', 'ing', 'cj', 'job']

function isPodsActive() { return active.value === 'pods' }

const podsRef = ref<any>(null)
function selectPodByKey(key: string) { podsRef.value?.selectByKey?.(key) }

defineExpose({ cycleTab, isPodsActive, selectPodByKey })

const count = (t: ResourceType) => t === 'llm' ? llmEndpoints.value.length : t === 'pods' ? pods.value.length : (filtered.value as any)[t].length
</script>

<template>
  <div>
    <div class="flex items-center gap-1 mb-2 flex-wrap">
      <button v-for="t in RESOURCE_TYPES" :key="t"
        @click="active = t"
        :class="active === t ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
        class="px-1.5 py-0.5 text-xs rounded transition-colors">
        {{ t }}<span class="text-zinc-600 ml-0.5">{{ count(t) }}</span>
      </button>
      <button @click="loadResources" class="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">↻</button>
    </div>

    <LLMPanel v-if="active === 'llm'" />

    <PodsPanel v-else-if="active === 'pods'" ref="podsRef" :pods="pods" :focusedIndex="focusedPodIndex" />

    <ResourceTable v-else-if="active === 'deploy'" :rows="filtered.deploy" :cols="cols.deploy" :kind="kinds.deploy">
      <template #actions="{ row }">
        <button @click="scale(row.namespace, row.name)" class="text-zinc-600 hover:text-blue-400 mr-1" title="Scale">⇕</button>
        <button @click="restart(row.namespace, row.name)" class="text-zinc-600 hover:text-amber-400" title="Restart">↻</button>
      </template>
    </ResourceTable>

    <ResourceTable v-else-if="active === 'rs'" :rows="filtered.rs" :cols="cols.rs" />
    <ResourceTable v-else :rows="(filtered as any)[active]" :cols="cols[active]" :kind="kinds[active]" />
  </div>
</template>
