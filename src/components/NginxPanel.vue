<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NginxStats } from '../lib/types'
import { httpStatusCategoryColor, formatBytes } from '../lib/formatters'

const props = defineProps<{ data: NginxStats | null }>()
const showAllIPs = ref(false)
const showAllHosts = ref(false)
const showAllPaths = ref(false)

const sortedHosts = computed(() => {
  if (!props.data) return []
  return Object.entries(props.data.byHost).sort((a, b) => b[1] - a[1])
})
</script>

<template>
  <div v-if="data" class="space-y-2">
    <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
      <div class="flex items-center gap-4 text-xs mb-1.5">
        <span class="text-zinc-500">TRAFFIC</span>
        <span class="text-zinc-400">{{ data.requestsTotal }} reqs</span>
        <span class="text-zinc-400">avg {{ data.avgResponseTime }}ms</span>
        <span v-if="data.avgUpstreamTime" class="text-zinc-500">upstream {{ data.avgUpstreamTime }}ms</span>
        <span v-if="data.totalBytes" class="text-zinc-500">{{ formatBytes(data.totalBytes) }}</span>
        <span v-if="data.wafBlocks" class="text-red-400">WAF:{{ data.wafBlocks }}</span>
      </div>
      <div class="flex gap-3 text-xs flex-wrap">
        <span v-for="(count, status) in data.byStatus" :key="status"
          :class="httpStatusCategoryColor(String(status))">
          {{ status }}:{{ count }}
        </span>
      </div>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
      <!-- IPs -->
      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-1">
          <span>TOP IPs ({{ data.topIPs.length }})</span>
          <button v-if="data.topIPs.length > 8" @click="showAllIPs = !showAllIPs" class="text-zinc-600 hover:text-zinc-400">{{ showAllIPs ? 'less' : 'all' }}</button>
        </div>
        <div v-for="ip in (showAllIPs ? data.topIPs : data.topIPs.slice(0, 8))" :key="ip.ip" class="text-xs flex justify-between">
          <span class="text-zinc-400 truncate">{{ ip.ip }}</span>
          <span class="text-amber-400 ml-2">{{ ip.count }}</span>
        </div>
      </div>

      <!-- Hosts -->
      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-1">
          <span>HOSTS ({{ sortedHosts.length }})</span>
          <button v-if="sortedHosts.length > 8" @click="showAllHosts = !showAllHosts" class="text-zinc-600 hover:text-zinc-400">{{ showAllHosts ? 'less' : 'all' }}</button>
        </div>
        <div v-for="[host, count] in (showAllHosts ? sortedHosts : sortedHosts.slice(0, 8))" :key="host" class="text-xs flex justify-between">
          <span class="text-zinc-400 truncate">{{ host }}</span>
          <span class="text-zinc-600 ml-2">{{ count }}</span>
        </div>
      </div>

      <!-- TLS -->
      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="text-xs text-zinc-500 mb-1">TLS</div>
        <div v-for="(count, ver) in data.tlsVersions" :key="ver" class="text-xs flex justify-between">
          <span class="text-zinc-400">{{ ver }}</span>
          <span class="text-zinc-600">{{ count }}</span>
        </div>
      </div>

      <!-- Paths -->
      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="flex items-center justify-between text-xs text-zinc-500 mb-1">
          <span>PATHS ({{ data.topPaths.length }})</span>
          <button v-if="data.topPaths.length > 8" @click="showAllPaths = !showAllPaths" class="text-zinc-600 hover:text-zinc-400">{{ showAllPaths ? 'less' : 'all' }}</button>
        </div>
        <div v-for="p in (showAllPaths ? data.topPaths : data.topPaths.slice(0, 8))" :key="p.uri" class="text-xs flex justify-between gap-2">
          <span class="text-zinc-400 truncate" :title="p.uri">{{ p.uri }}</span>
          <span class="text-zinc-600 shrink-0">{{ p.count }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
