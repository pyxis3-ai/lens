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

// --- User ---
const user = ref<{ name: string; email: string; initial: string }>({ name: '', email: '', initial: '?' })
async function loadUser() {
  try {
    const res = await fetch('/api/user')
    if (res.ok) user.value = await res.json()
  } catch {}
}

// --- Sidebar ---
const sidebarOpen = ref(false)
const accountOpen = ref(false)

const products = [
  { name: 'Pyxis Funnel', href: 'https://pyxis3.com' },
  { name: 'Pyxis Engine', href: 'https://pyxis3.com' },
  { name: 'Pyxis Lens', href: '/' },
]

const accountLinks = [
  { name: 'Settings', href: 'https://account.jsr.bz' },
  { name: 'Security', href: 'https://auth.jsr.bz' },
  { name: 'Logout', href: 'https://auth.jsr.bz/logout' },
]

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
  // Cmd+K spotlight
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    spotlightOpen.value = !spotlightOpen.value
    spotlightQuery.value = ''
    return
  }

  if (e.key === 'Escape') {
    if (spotlightOpen.value) { spotlightOpen.value = false; return }
    if (sidebarOpen.value) { sidebarOpen.value = false; return }
    if (accountOpen.value) { accountOpen.value = false; return }
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

  // j/k navigate pods
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

  // [ and ] cycle sub-tabs
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

let refreshInterval: any = null
onMounted(() => {
  connect()
  loadUser()
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
  <div class="min-h-screen bg-void flex">
    <!-- Sidebar -->
    <aside :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
      class="fixed inset-y-0 left-0 z-40 w-56 bg-zinc-950 border-r border-zinc-800 transform transition-transform duration-200 lg:translate-x-0 lg:static lg:z-auto flex flex-col">
      <!-- Logo -->
      <div class="px-4 py-4 border-b border-zinc-800">
        <a href="/" class="text-lg font-black text-white tracking-tighter uppercase">PYXIS LENS</a>
        <p class="text-[9px] text-zinc-600 uppercase tracking-widest mt-0.5">Infrastructure Monitor</p>
      </div>

      <!-- Products -->
      <nav class="flex-1 px-3 py-3 space-y-0.5">
        <div class="text-[10px] text-zinc-600 uppercase tracking-wider px-2 mb-2">Products</div>
        <a v-for="p in products" :key="p.name" :href="p.href"
          :class="p.href === '/' ? 'bg-emerald-600/10 text-emerald-400 border-l-2 border-emerald-500' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'"
          class="block px-3 py-1.5 text-xs rounded-r transition-colors">
          {{ p.name }}
        </a>
      </nav>

      <!-- Account -->
      <div class="border-t border-zinc-800 px-3 py-3">
        <button @click="accountOpen = !accountOpen" class="flex items-center gap-2 w-full text-left hover:bg-zinc-800/50 rounded px-2 py-1.5 transition-colors">
          <span class="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-xs text-white font-bold shrink-0">{{ user.initial }}</span>
          <span class="text-xs text-zinc-300 truncate">{{ user.name || user.email || 'User' }}</span>
        </button>
        <div v-if="accountOpen" class="mt-1 space-y-0.5">
          <a v-for="link in accountLinks" :key="link.name" :href="link.href"
            class="block px-3 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 rounded transition-colors">
            {{ link.name }}
          </a>
        </div>
      </div>
    </aside>

    <!-- Sidebar overlay (mobile) -->
    <div v-if="sidebarOpen" class="fixed inset-0 bg-black/50 z-30 lg:hidden" @click="sidebarOpen = false" />

    <!-- Main content -->
    <div class="flex-1 min-w-0">
      <!-- Top bar -->
      <div class="border-b border-zinc-800 bg-zinc-950/80 sticky top-0 z-20">
        <div class="flex items-center gap-3 px-4 py-2">
          <button @click="sidebarOpen = !sidebarOpen" class="text-zinc-400 hover:text-zinc-200 lg:hidden">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </button>
          <h1 class="text-sm font-bold text-white tracking-tight uppercase">Monitoring</h1>
          <button @click="spotlightOpen = true" class="ml-auto flex items-center gap-1.5 bg-zinc-800/50 border border-zinc-700/50 rounded px-2.5 py-1 text-xs text-zinc-500 hover:text-zinc-300 hover:border-zinc-600 transition-colors">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            Search
            <kbd class="text-[10px] text-zinc-600 ml-2">\u2318K</kbd>
          </button>
          <span :class="connected ? 'text-emerald-400' : 'text-red-400'" class="text-xs ml-2">{{ connected ? '\u25CF' : '\u25CB' }}</span>
        </div>
      </div>

      <!-- Monitoring Content -->
      <div class="p-2 sm:p-3 space-y-2">
        <AlertBar :alerts="activeAlerts" />
        <SystemPanel :data="system" />
        <NodeBar />
        <HealthPanel :services="services" />

        <div class="flex items-center gap-1 border-b border-zinc-800 pb-1.5 pt-1">
          <span class="text-emerald-400 font-semibold text-xs tracking-wide mr-2">LENS</span>
          <nav class="flex gap-0.5">
            <button v-for="(t, i) in SECTIONS" :key="t" @click="selectedSection = t"
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
            <button @click="loadAttacks" class="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">\u21BB</button>
          </div>
          <SecurityPanel v-if="securityView === 'fail2ban'" :data="security" />
          <NginxPanel v-else-if="securityView === 'traffic'" :data="nginxStats" />
          <AttackLog v-else-if="securityView === 'attacks'" />
          <SSHPanel v-else-if="securityView === 'ssh'" />
          <AutheliaPanel v-else-if="securityView === 'auth'" />
        </template>

        <EventsPanel v-else-if="selectedSection === 'events'" ref="eventsRef" />
      </div>
    </div>

    <!-- Spotlight overlay -->
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
              <span :class="pod.ready ? 'text-emerald-400' : 'text-red-400'">\u25CF</span>
              <span class="text-zinc-500">{{ pod.namespace }}/</span>{{ pod.name }}
            </div>
          </template>
          <div v-else class="px-3 py-2 text-xs text-zinc-600">Type to search...</div>
        </div>
      </div>
    </div>
  </div>
</template>
