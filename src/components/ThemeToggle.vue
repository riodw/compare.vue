<script setup lang="ts">
import { useColorMode } from "@vueuse/core";

const mode = useColorMode({
  attribute: "data-bs-theme",
});

function changeTheme() {
  mode.value = mode.value === "dark" ? "light" : "dark";
}
</script>

<template>
  <button
    class="btn btn-link text-body"
    @click="changeTheme()"
    title="Toggle theme"
  >
    <i v-if="mode === 'dark'" class="bi bi-moon-fill"></i>
    <i v-else class="bi bi-brightness-high-fill"></i>
  </button>
</template>
