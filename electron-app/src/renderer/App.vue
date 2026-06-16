<script setup lang="ts">
import EncounterHistoryView from './views/EncounterHistoryView.vue'

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
      <div class="brand">
        <h1>LOA METER CN</h1>
        <span class="subtitle">战斗查询 · 实时数据在悬浮窗显示</span>
      </div>
      <nav>
        <button type="button" class="ghost" @click="toggleOverlayClickThrough()">
          浮窗穿透
        </button>
      </nav>
    </header>

    <main>
      <EncounterHistoryView />
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

.brand {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.topbar h1 {
  margin: 0;
  font-size: 18px;
}

.subtitle {
  font-size: 12px;
  color: #7f8aa3;
}

nav {
  display: flex;
  gap: 8px;
}

nav button.ghost {
  font-size: 12px;
}

main {
  padding: 20px;
  flex: 1;
}
</style>
