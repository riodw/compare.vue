<script setup lang="ts">
// Simple POC page switcher for the Cross-Page Introspection Query State test.
// Each option renders a different schema-driven page (different ROOT).
// The components unmount/remount on switch, which triggers their boot
// watchers and reconcileFromStore() on the new ROOT's tree.
const currentPage = ref<"tools" | "toolMetrics">("tools");
</script>

<template>
  <div id="viewport" class="container-fluid">
    <NavTop />
    <div class="row pt-4 mt-5">
      <!-- LEFT-NAV -->
      <NavLeft />
      <!-- CONTENT -->
      <div class="col">
        <!-- POC page switcher -->
        <div class="mx-auto mb-3" style="max-width: 1400px">
          <div class="btn-group" role="group">
            <button
              class="btn btn-sm"
              :class="currentPage === 'tools' ? 'btn-primary' : 'btn-outline-primary'"
              @click="currentPage = 'tools'"
            >
              Tools
            </button>
            <button
              class="btn btn-sm"
              :class="currentPage === 'toolMetrics' ? 'btn-primary' : 'btn-outline-primary'"
              @click="currentPage = 'toolMetrics'"
            >
              Tool Metrics
            </button>
          </div>
        </div>
        <Home3 v-if="currentPage === 'tools'" />
        <Home3ToolMetrics v-else />
      </div>
    </div>
  </div>
</template>

<style lang="scss">
/* LEFT NAV */
#viewport {
  #left-nav {
    width: 250px;
    z-index: 1000;
    height: 100vh;
    overflow-x: hidden;
    overflow-y: auto;

    .nav-link {
      letter-spacing: 0.2px;
    }
  }

  .offcanvas-backdrop {
    display: none;
  }

  &.toggled {
    #left-nav {
      display: none;
    }
  }
}

@media screen and (max-width: 1910px) {
  #viewport.toggled {
    #left-nav {
      display: block;
      margin-left: 0;
      top: 0;
    }
    .offcanvas-backdrop {
      display: block;
    }
  }
  #left-nav {
    display: none;
  }
}
</style>
