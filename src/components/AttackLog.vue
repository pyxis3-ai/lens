<script setup lang="ts">
import { ref } from 'vue'
import { attacks, attackStats, loadAttacks } from '../lib/ws'
import { httpStatusColor } from '../lib/formatters'

const expandedRow = ref(-1)
const showAllIPs = ref(false)
</script>

<template>
  <div>
    <div v-if="attackStats" class="flex gap-4 mb-2 text-xs flex-wrap">
      <span class="text-zinc-500">ATTACKS</span>
      <span class="text-zinc-400">1h:<span class="text-amber-400">{{ attackStats.last1h }}</span></span>
      <span class="text-zinc-400">24h:<span class="text-amber-400">{{ attackStats.last24h }}</span></span>
      <button @click="loadAttacks" class="text-zinc-600 hover:text-zinc-400">\u21BB</button>
    </div>

    <div v-if="attackStats?.topIPs?.length" class="flex gap-3 mb-2 text-xs flex-wrap items-center">
      <span class="text-zinc-600">top:</span>
      <span v-for="t in (showAllIPs ? attackStats.topIPs : attackStats.topIPs.slice(0, 5))" :key="t.ip" class="text-zinc-500">
        {{ t.ip }} <span class="text-red-400">{{ t.c }}</span>
      </span>
      <button v-if="attackStats.topIPs.length > 5" @click="showAllIPs = !showAllIPs" class="text-zinc-600 hover:text-zinc-400">
        {{ showAllIPs ? 'less' : `+${attackStats.topIPs.length - 5}` }}
      </button>
    </div>

    <div v-if="attacks.length" class="overflow-x-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-zinc-600 border-b border-zinc-800">
            <th class="text-left px-2 py-1">TIME</th>
            <th class="text-left px-2 py-1">IP</th>
            <th class="text-left px-2 py-1">ST</th>
            <th class="text-left px-2 py-1">METHOD</th>
            <th class="text-left px-2 py-1">HOST</th>
            <th class="text-left px-2 py-1">URI</th>
            <th class="text-left px-2 py-1">UA</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="(a, i) in attacks" :key="i">
            <tr class="border-b border-zinc-800/30 cursor-pointer"
              :class="expandedRow === i ? 'bg-zinc-800/30' : 'row-hover'"
              @click="expandedRow = expandedRow === i ? -1 : i">
              <td class="px-2 py-0.5 text-zinc-600 whitespace-nowrap">{{ a.time?.slice(11, 19) }}</td>
              <td class="px-2 py-0.5 text-zinc-400">{{ a.ip }}</td>
              <td class="px-2 py-0.5" :class="httpStatusColor(a.status)">{{ a.status }}</td>
              <td class="px-2 py-0.5 text-zinc-500">{{ a.method }}</td>
              <td class="px-2 py-0.5 text-zinc-500 max-w-28 truncate">{{ a.host }}</td>
              <td class="px-2 py-0.5 text-zinc-400 max-w-44 truncate">{{ a.uri }}</td>
              <td class="px-2 py-0.5 text-zinc-600 max-w-40 truncate">{{ a.ua || '-' }}</td>
            </tr>
            <tr v-if="expandedRow === i" class="bg-zinc-900/30">
              <td colspan="7" class="px-4 py-1.5 text-xs space-y-0.5">
                <div><span class="text-zinc-600">host:</span> <span class="text-zinc-400">{{ a.host }}</span></div>
                <div><span class="text-zinc-600">uri:</span> <span class="text-zinc-400 break-all">{{ a.uri }}</span></div>
                <div><span class="text-zinc-600">ua:</span> <span class="text-zinc-400 break-all">{{ a.ua || '-' }}</span></div>
                <div><span class="text-zinc-600">time:</span> <span class="text-zinc-400">{{ a.time }}</span></div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-else class="text-zinc-600 text-xs">no attacks</div>
  </div>
</template>
