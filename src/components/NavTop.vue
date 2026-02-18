<script setup lang="ts">
function changeTheme() {
  if (document.documentElement.getAttribute("data-bs-theme") === "dark")
    document.documentElement.setAttribute("data-bs-theme", "light");
  else document.documentElement.setAttribute("data-bs-theme", "dark");
}
</script>

<template>
  <nav
    class="navbar navbar-expand-lg fixed-top bg-body shadow-sm user-select-none"
    style="z-index: 800"
  >
    <div class="container-fluid align-items-center">
      <Logo />
      <!-- <div class="container d-none d-md-flex flex-fill"></div> -->
      <div class="d-flex flex-shrink-0">
        <button class="btn btn-link text-body" @click="changeTheme()">
          <i class="bi bi-brightness-high-fill"></i>
        </button>
        <div class="dropdown">
          <button
            class="btn btn-link text-body"
            data-bs-theme-value="dark"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <!-- <i class="bi bi-grid-fill"></i> -->
            <i class="bi bi-x-diamond-fill"></i>
          </button>
          <ul class="dropdown-menu text-center dropdown-menu-end">
            <li>
              <div class="dropdown-item disabled">APPS</div>
            </li>
            <li>
              <a class="dropdown-item fw-bold" href="#">DoormatKey🔑</a>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </nav>
</template>
