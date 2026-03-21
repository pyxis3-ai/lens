<script setup lang="ts">
import { nodes } from '../lib/ws'
import { formatBytes, timeAgo } from '../lib/formatters'
</script>

<template>
  <div v-if="nodes.length" class="flex flex-wrap gap-2">
    <div v-for="n in nodes" :key="n.name"
      class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-1 flex-1 min-w-0">
      <div class="flex items-center gap-3 text-xs flex-wrap">
        <span :class="n.status === 'Ready' ? 'text-emerald-400' : 'text-red-400'">{{ n.status === 'Ready' ? '\u25CF' : '\u2715' }}</span>
        <span class="text-zinc-400">{{ n.name }}</span>
        <span class="text-zinc-500">cpu:<span class="text-zinc-400">{{ n.cpu !== null ? `${n.cpu.toFixed(0)}m` : '-' }}</span>/{{ n.allocatable.cpu.toFixed(0) }}m</span>
        <span class="text-zinc-500">mem:<span class="text-zinc-400">{{ n.memory !== null ? formatBytes(n.memory) : '-' }}</span>/{{ formatBytes(n.allocatable.memory) }}</span>
        <span class="text-zinc-500">pods:{{ n.allocatable.pods }}</span>
        <span class="text-zinc-600">{{ n.version }}</span>
        <span class="text-zinc-600">{{ timeAgo(n.age) }}</span>
        <span v-for="cond in n.conditions" :key="cond" class="text-red-400">{{ cond }}</span>
      </div>
    </div>
  </div>
</template>
