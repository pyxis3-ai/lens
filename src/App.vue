<script setup lang="ts">
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import {
  connect, system, pods, security, services, nginxStats, activeAlerts, connected,
  loadAttacks, loadEvents, loadResources, loadThresholds,
  namespaceFilter,
} from './lib/ws'
import SystemPanel from './components/SystemPanel.vue'
import SecurityPanel from './components/SecurityPanel.vue'
import EventsPanel from './components/EventsPanel.vue'
import HealthPanel from './components/HealthPanel.vue'
import NginxPanel from './components/NginxPanel.vue'
import AttackLog from './components/AttackLog.vue'
import SSHPanel from './components/SSHPanel.vue'
import AutheliaPanel from './components/AutheliaPanel.vue'
import AlertBar from './components/AlertBar.vue'
import ResourcesPanel from './components/ResourcesPanel.vue'
import NodeBar from './components/NodeBar.vue'

// --- Spotlight search ---
const spotlightOpen = ref(false)
const spotlightQuery = ref('')

// --- Monitoring sections ---
type Section = 'resources' | 'security' | 'events'
const SECTIONS: Section[] = ['resources', 'security', 'events']

const selectedSection = ref<Section>('resources')
const focusedPodIndex = ref(-1)

type SecurityView = 'fail2ban' | 'traffic' | 'attacks' | 'ssh' | 'auth'
const SECURITY_VIEWS: SecurityView[] = ['fail2ban', 'traffic', 'attacks', 'ssh', 'auth']
const securityView = ref<SecurityView>('fail2ban')

const resourcesRef = ref<any>(null)
const eventsRef = ref<any>(null)

const allNamespaces = computed(() => [...new Set(pods.value.map(p => p.namespace))].sort())
const podCount = computed(() => pods.value.length)
const runningCount = computed(() => pods.value.filter(p => p.status === 'Running' && p.ready).length)
const issueCount = computed(() => pods.value.filter(p => p.status !== 'Running' || !p.ready || p.restarts > 0).length)
const totalBanned = computed(() => security.value?.totalBanned || 0)

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    spotlightOpen.value = !spotlightOpen.value
    spotlightQuery.value = ''
    return
  }

  if (e.key === 'Escape') {
    if (spotlightOpen.value) { spotlightOpen.value = false; return }
  }

  const tag = (e.target as HTMLElement).tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return
  if ((e.target as HTMLElement).closest('.xterm')) return

  const tabNum = parseInt(e.key)
  if (tabNum >= 1 && tabNum <= 3) {
    selectedSection.value = SECTIONS[tabNum - 1]
    focusedPodIndex.value = -1
    return
  }

  if (selectedSection.value === 'resources' && resourcesRef.value?.isPodsActive?.()) {
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (focusedPodIndex.value < 0) focusedPodIndex.value = 0
      else focusedPodIndex.value = Math.min(focusedPodIndex.value + 1, pods.value.length - 1)
      return
    }
    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusedPodIndex.value = Math.max(focusedPodIndex.value - 1, 0)
      return
    }
    if (e.key === 'Enter' && focusedPodIndex.value >= 0) {
      const pod = pods.value[focusedPodIndex.value]
      if (pod) resourcesRef.value?.selectPodByKey?.(`${pod.namespace}/${pod.name}`)
      return
    }
  }

  if (e.key === '[' || e.key === ']') {
    const dir = e.key === ']' ? 1 : -1
    if (selectedSection.value === 'security') {
      const idx = SECURITY_VIEWS.indexOf(securityView.value)
      securityView.value = SECURITY_VIEWS[(idx + dir + SECURITY_VIEWS.length) % SECURITY_VIEWS.length]
    } else if (selectedSection.value === 'resources' && resourcesRef.value?.cycleTab) {
      resourcesRef.value.cycleTab(dir)
    } else if (selectedSection.value === 'events' && eventsRef.value?.cycleTab) {
      eventsRef.value.cycleTab(dir)
    }
    return
  }

  if (e.key === 'r') {
    if (selectedSection.value === 'security') loadAttacks()
    if (selectedSection.value === 'events') loadEvents()
    if (selectedSection.value === 'resources') loadResources()
    return
  }
}

watch(selectedSection, (section) => {
  if (section === 'security') loadAttacks()
  if (section === 'events') loadEvents()
  if (section === 'resources') loadResources()
})

let refreshInterval: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  connect()
  loadResources()
  loadThresholds()
  document.addEventListener('keydown', onKeydown)
  refreshInterval = setInterval(() => {
    if (selectedSection.value === 'security') loadAttacks()
    if (selectedSection.value === 'events') loadEvents()
    if (selectedSection.value === 'resources') loadResources()
  }, 30000)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (refreshInterval) clearInterval(refreshInterval)
})
</script>

<template>
  <div class="min-h-screen bg-zinc-950 text-zinc-100">
    <!-- Top bar -->
    <div class="border-b border-zinc-800 bg-zinc-950/80 sticky top-0 z-20">
      <div class="flex items-center gap-3 px-4 py-2">
        <h1 class="text-sm font-bold text-white tracking-tight uppercase">Lens</h1>
        <button @click="spotlightOpen = true" class="ml-auto flex items-center gap-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          Search
          <kbd class="text-[10px] text-zinc-600 ml-2">⌘K</kbd>
        </button>
        <span :class="connected ? 'text-emerald-400' : 'text-red-400'" class="text-xs ml-2">{{ connected ? '●' : '○' }}</span>
      </div>
    </div>

    <!-- Content -->
    <div class="p-2 sm:p-3 space-y-2">
      <AlertBar :alerts="activeAlerts" />
      <SystemPanel :data="system" />
      <NodeBar />
      <HealthPanel :services="services" />

      <div class="flex items-center gap-1 border-b border-zinc-800 pb-1.5 pt-1">
        <nav class="flex gap-0.5">
          <button v-for="t in SECTIONS" :key="t" @click="selectedSection = t"
            :class="selectedSection === t ? 'bg-emerald-600 text-white' : 'text-zinc-400 hover:bg-zinc-800'"
            class="px-2 sm:px-3 py-0.5 text-xs uppercase tracking-wider transition-colors rounded-sm">
            {{ t }}
            <template v-if="t === 'resources'">
              <span class="opacity-60 ml-1">{{ runningCount }}/{{ podCount }}</span><span v-if="issueCount" class="text-amber-300 ml-0.5">{{ issueCount }}</span>
            </template>
            <template v-else-if="t === 'security'">
              <span v-if="totalBanned" class="text-red-300 ml-1">{{ totalBanned }}</span>
            </template>
          </button>
        </nav>
        <select v-model="namespaceFilter"
          class="bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs rounded px-1.5 py-0.5 ml-2 max-w-28">
          <option value="">all ns</option>
          <option v-for="ns in allNamespaces" :key="ns" :value="ns">{{ ns }}</option>
        </select>
        <div class="flex items-center gap-2 ml-auto">
          <span class="text-zinc-700 text-xs hidden sm:inline">1-3:tabs [/]:sub r:refresh j/k:nav</span>
        </div>
      </div>

      <ResourcesPanel v-if="selectedSection === 'resources'" ref="resourcesRef" :focusedPodIndex="focusedPodIndex" />

      <template v-else-if="selectedSection === 'security'">
        <div class="flex items-center gap-1 mb-2">
          <button v-for="t in SECURITY_VIEWS" :key="t" @click="securityView = t"
            :class="securityView === t ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:bg-zinc-800'"
            class="px-2 py-0.5 text-xs rounded transition-colors">{{ t }}</button>
          <button @click="loadAttacks" class="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">↻</button>
        </div>
        <SecurityPanel v-if="securityView === 'fail2ban'" :data="security" />
        <NginxPanel v-else-if="securityView === 'traffic'" :data="nginxStats" />
        <AttackLog v-else-if="securityView === 'attacks'" />
        <SSHPanel v-else-if="securityView === 'ssh'" />
        <AutheliaPanel v-else-if="securityView === 'auth'" />
      </template>

      <EventsPanel v-else-if="selectedSection === 'events'" ref="eventsRef" />
    </div>

    <!-- Spotlight -->
    <div v-if="spotlightOpen" class="fixed inset-0 bg-black/60 flex items-start justify-center pt-[20vh] z-50" @click.self="spotlightOpen = false">
      <div class="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md mx-4">
        <div class="flex items-center gap-2 px-4 py-3 border-b border-zinc-800">
          <svg class="w-4 h-4 text-zinc-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
          <input v-model="spotlightQuery" autofocus placeholder="Search pods, deployments, namespaces..." class="bg-transparent text-sm text-zinc-200 outline-none flex-1" @keydown.escape="spotlightOpen = false" />
        </div>
        <div class="max-h-64 overflow-auto p-2">
          <template v-if="spotlightQuery">
            <div v-for="pod in pods.filter(p => p.name.toLowerCase().includes(spotlightQuery.toLowerCase()) || p.namespace.toLowerCase().includes(spotlightQuery.toLowerCase())).slice(0, 10)"
              :key="`${pod.namespace}/${pod.name}`"
              @click="selectedSection = 'resources'; spotlightOpen = false"
              class="px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 rounded cursor-pointer flex items-center gap-2">
              <span :class="pod.ready ? 'text-emerald-400' : 'text-red-400'">●</span>
              <span class="text-zinc-500">{{ pod.namespace }}/</span>{{ pod.name }}
            </div>
          </template>
          <div v-else class="px-3 py-2 text-xs text-zinc-600">Type to search...</div>
        </div>
      </div>
    </div>
  </div>
</template>
