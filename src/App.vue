<script setup lang="ts">
import Home from "@/components/Home.vue"
</script>

<template>
  <SidebarProvider class="flex flex-col min-h-screen">
    <NavTop />
    <div class="flex flex-1 overflow-hidden">
      <NavLeft />
      <SidebarInset>
        <main>
          <Home />
        </main>
      </SidebarInset>
    </div>
  </SidebarProvider>
</template>
