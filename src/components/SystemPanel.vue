<script setup lang="ts">
import type { SystemMetrics } from '../lib/types'
import { formatUptime, formatRate, barColor, metricColor } from '../lib/formatters'

defineProps<{ data: SystemMetrics | null }>()
</script>

<template>
  <div v-if="data" class="bg-zinc-900/50 border border-zinc-800/50 rounded px-3 py-1 text-xs flex items-center gap-3 flex-wrap">
    <div class="flex items-center gap-1">
      <span class="text-zinc-500">CPU</span>
      <div class="h-3 bg-zinc-800 rounded-sm w-12 overflow-hidden relative">
        <div :class="barColor(data.cpu.percent)" class="h-full" :style="{ width: data.cpu.percent + '%' }" />
        <span class="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-300 mix-blend-difference">{{ data.cpu.percent }}%</span>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <span class="text-zinc-500">MEM</span>
      <div class="h-3 bg-zinc-800 rounded-sm w-12 overflow-hidden relative">
        <div :class="barColor(data.memory.percent)" class="h-full" :style="{ width: data.memory.percent + '%' }" />
        <span class="absolute inset-0 flex items-center justify-center text-[9px] text-zinc-300 mix-blend-difference">{{ data.memory.percent }}%</span>
      </div>
    </div>
    <div class="flex items-center gap-1">
      <span class="text-zinc-500">SWP</span>
      <div class="h-3 bg-zinc-800 rounded-sm w-10 overflow-hidden"><div :class="barColor(data.swap.percent, 20, 50)" class="h-full" :style="{ width: data.swap.percent + '%' }" /></div>
      <span :class="metricColor(data.swap.percent, 20, 50)">{{ data.swap.percent }}%</span>
    </div>
    <div class="flex items-center gap-1">
      <span class="text-zinc-500">DSK</span>
      <div class="h-3 bg-zinc-800 rounded-sm w-10 overflow-hidden"><div :class="barColor(data.disk.percent, 70, 90)" class="h-full" :style="{ width: data.disk.percent + '%' }" /></div>
      <span :class="metricColor(data.disk.percent, 70, 90)">{{ data.disk.percent }}%</span>
    </div>
    <div class="flex items-center gap-2 text-zinc-600 ml-auto">
      <span><span class="text-emerald-400">\u2193</span>{{ formatRate(data.network.rxRate) }}</span>
      <span><span class="text-blue-400">\u2191</span>{{ formatRate(data.network.txRate) }}</span>
      <span>tcp:{{ data.network.connections }}</span>
      <span>load:{{ data.cpu.load1.toFixed(1) }}</span>
      <span>up:{{ formatUptime(data.uptime) }}</span>
    </div>
  </div>
  <div v-else class="text-zinc-600 text-xs animate-pulse">connecting...</div>
</template>
