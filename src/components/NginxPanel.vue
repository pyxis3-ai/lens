<script setup lang="ts">
import { computed } from 'vue'
import type { NginxStats } from '../lib/types'
import { httpStatusCategoryColor, formatBytes } from '../lib/formatters'
import ExpandableList from './ExpandableList.vue'

const props = defineProps<{ data: NginxStats | null }>()

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
      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="text-xs text-zinc-500 mb-1">TOP IPs ({{ data.topIPs.length }})</div>
        <ExpandableList :items="data.topIPs" :limit="8">
          <template #default="{ item }">
            <div class="text-xs flex justify-between">
              <span class="text-zinc-400 truncate">{{ item.ip }}</span>
              <span class="text-amber-400 ml-2">{{ item.count }}</span>
            </div>
          </template>
        </ExpandableList>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="text-xs text-zinc-500 mb-1">HOSTS ({{ sortedHosts.length }})</div>
        <ExpandableList :items="sortedHosts" :limit="8">
          <template #default="{ item: [host, count] }">
            <div class="text-xs flex justify-between">
              <span class="text-zinc-400 truncate">{{ host }}</span>
              <span class="text-zinc-600 ml-2">{{ count }}</span>
            </div>
          </template>
        </ExpandableList>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="text-xs text-zinc-500 mb-1">TLS</div>
        <div v-for="(count, ver) in data.tlsVersions" :key="ver" class="text-xs flex justify-between">
          <span class="text-zinc-400">{{ ver }}</span>
          <span class="text-zinc-600">{{ count }}</span>
        </div>
      </div>

      <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
        <div class="text-xs text-zinc-500 mb-1">PATHS ({{ data.topPaths.length }})</div>
        <ExpandableList :items="data.topPaths" :limit="8">
          <template #default="{ item }">
            <div class="text-xs flex justify-between gap-2">
              <span class="text-zinc-400 truncate" :title="item.uri">{{ item.uri }}</span>
              <span class="text-zinc-600 shrink-0">{{ item.count }}</span>
            </div>
          </template>
        </ExpandableList>
      </div>
    </div>
  </div>
</template>
