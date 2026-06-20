<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { autheliaStats, loadAuthelia } from '../lib/ws'
import ExpandableList from './ExpandableList.vue'

onMounted(loadAuthelia)

const sortedHosts = computed(() => {
  if (!autheliaStats.value?.byHost) return []
  return Object.entries(autheliaStats.value.byHost).sort((a, b) => (b[1] as number) - (a[1] as number))
})
</script>

<template>
  <div v-if="!autheliaStats" class="text-zinc-600 text-xs animate-pulse">loading...</div>
  <div v-else class="space-y-2">
    <div class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-2">
      <div class="flex items-center gap-4 text-xs mb-1.5">
        <span class="text-zinc-500">AUTHELIA</span>
        <span class="text-zinc-400">requests:{{ autheliaStats.requests }}</span>
        <span :class="autheliaStats.blocked > 0 ? 'text-amber-400' : 'text-zinc-600'">blocked:{{ autheliaStats.blocked }}</span>
        <button @click="loadAuthelia" class="text-zinc-600 hover:text-zinc-400 ml-auto">↻</button>
      </div>

      <div v-if="sortedHosts.length" class="text-xs">
        <div class="mb-0.5"><span class="text-zinc-600">blocked by host:</span></div>
        <div class="flex flex-wrap gap-2">
          <ExpandableList :items="sortedHosts" :limit="8">
            <template #default="{ item: [host, count] }">
              <span class="text-zinc-500">{{ host }} <span class="text-amber-400">{{ count }}</span></span>
            </template>
          </ExpandableList>
        </div>
      </div>
    </div>

    <div v-if="autheliaStats.recent?.length" class="overflow-x-auto">
      <div class="text-xs text-zinc-500 mb-1">RECENT AUTH</div>
      <table class="w-full text-xs">
        <thead>
          <tr class="text-zinc-600 border-b border-zinc-800">
            <th class="text-left px-2 py-1">TIME</th>
            <th class="text-left px-2 py-1">USER</th>
            <th class="text-left px-2 py-1">HOST</th>
            <th class="text-left px-2 py-1">STATUS</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(a, i) in autheliaStats.recent" :key="i" class="row-hover border-b border-zinc-800/30">
            <td class="px-2 py-0.5 text-zinc-600 whitespace-nowrap">{{ a.time?.slice(11, 19) }}</td>
            <td class="px-2 py-0.5 text-zinc-400">{{ a.user }}</td>
            <td class="px-2 py-0.5 text-zinc-500">{{ a.host }}</td>
            <td class="px-2 py-0.5" :class="a.status >= 400 ? 'text-red-400' : 'text-emerald-400'">{{ a.status }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
