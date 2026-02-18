<script setup lang="ts">
import Home from "@/components/Home.vue"
</script>

<template>
  <SidebarProvider>
    <NavLeft />
    <SidebarInset>
      <NavTop />
      <main>
        <Home />
      </main>
    </SidebarInset>
  </SidebarProvider>
</template>
