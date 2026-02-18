<script setup lang="ts"></script>

<template>
  <div id="viewport" class="container-fluid">
    <NavTop />
    <div class="row pt-4 mt-5">
      <!-- LEFT-NAV -->
      <NavLeft />
      <!-- CONTENT -->
      <Home />
    </div>
  </div>
</template>

<style lang="scss">
/* LEFT NAV */
#viewport {
  #left-nav {
    width: 255px;
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
