<script setup lang="ts">
import { ref } from 'vue'
import EncounterHistoryView from './views/EncounterHistoryView.vue'
import LiveMeterView from './views/LiveMeterView.vue'

const tab = ref<'live' | 'history'>('live')

async function toggleOverlayClickThrough(): Promise<void> {
  const settings = await window.overlayApi.toggleClickThrough()
  window.alert(
    settings.clickThrough
      ? '战斗浮窗已开启点击穿透（Ctrl+Shift+M 可切换）'
      : '战斗浮窗已恢复交互'
  )
}
</script>

<template>
  <div class="app">
    <header class="topbar">
      <h1>LOA METER CN</h1>
      <nav>
        <button
          type="button"
          :class="{ active: tab === 'live' }"
          @click="tab = 'live'"
        >
          实时
        </button>
        <button
          type="button"
          :class="{ active: tab === 'history' }"
          @click="tab = 'history'"
        >
          历史
        </button>
        <button type="button" class="ghost" @click="toggleOverlayClickThrough()">
          浮窗穿透
        </button>
      </nav>
    </header>

    <main>
      <LiveMeterView v-if="tab === 'live'" />
      <EncounterHistoryView v-else />
    </main>
  </div>
</template>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #2a3140;
  background: #171b24;
}

.topbar h1 {
  margin: 0;
  font-size: 18px;
}

nav {
  display: flex;
  gap: 8px;
}

nav button.active {
  background: #3d4f78;
  border-color: #5b74ad;
}

nav button.ghost {
  margin-left: 8px;
  font-size: 12px;
}

main {
  padding: 20px;
  flex: 1;
}
</style>
