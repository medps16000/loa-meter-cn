<script setup lang="ts">
import ClassIcon from './ClassIcon.vue'
import type { PartyRosterRow } from '../lib/meter-display'

defineProps<{
  roster: PartyRosterRow[]
}>()
</script>

<template>
  <section class="roster-panel" v-if="roster.length">
    <h3>队伍名单</h3>
    <div class="chips">
      <span v-for="member in roster" :key="`${member.characterId}-${member.name}`" class="chip">
        <ClassIcon :class-id="member.classId" :size="18" :title="member.name" />
        {{ member.name }}
        <small v-if="member.combatPower">战力 {{ member.combatPower.toFixed(1) }}</small>
        <small v-if="member.partyInstanceId">队 {{ member.partyInstanceId }}</small>
      </span>
    </div>
  </section>
</template>

<style scoped>
.roster-panel h3 {
  margin: 0 0 8px;
  font-size: 14px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: #222a3a;
  border: 1px solid #33415f;
  font-size: 13px;
}

.chip small {
  color: #8b93a7;
}
</style>
