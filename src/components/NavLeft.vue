<script setup lang="ts"></script>

<template>
  <div id="left-nav" class="fixed-top bg-body user-select-none p-0">
    <nav class="navbar bg-body shadow-sm" style="z-index: 1000">
      <div
        class="container-fluid justify-content-between align-items-center flex-nowrap"
      >
        <logo />
        <div class="container d-none d-md-flex flex-fill"></div>
      </div>
    </nav>
    <ul class="nav nav-pills flex-column px-3 pt-3 mb-auto">
      <li class="nav-item">
        <!-- onclick="document.getElementById('viewport').classList.toggle('toggled')" -->
        <a class="nav-link active">
          <i class="bi bi-house-fill"></i>
          &nbsp;Home
        </a>
      </li>
      <li class="mt-3 mb-1">
        <button
          class="btn btn-toggle d-inline-flex align-items-center rounded collapsed w-100"
          data-bs-toggle="collapse"
          data-bs-target="#home-collapse"
          aria-expanded="true"
        >
          <i class="bi bi-chevron-right"></i>
          &nbsp;
          <b>Get Started</b>
        </button>
        <div id="home-collapse" class="collapse">
          <ul class="btn-toggle-nav list-unstyled fw-normal pb-1 small">
            <li>
              <a href="#" class="nav-link link-dark rounded">
                <button class="btn btn-sm btn-primary">
                  <i class="bi bi-house-door"></i>
                </button>
                &nbsp;About Campfire
              </a>
            </li>
            <li>
              <a href="#" class="nav-link link-dark rounded">
                <button class="btn btn-sm btn-primary">
                  <i class="bi bi-chat-heart"></i>
                </button>
                &nbsp;Say Hello
              </a>
            </li>
          </ul>
        </div>
      </li>
    </ul>
  </div>
  <!-- <div
    onclick="document.getElementById('viewport').classList.toggle('toggled')"
    class="offcanvas-backdrop opacity-50"
    style="z-index: 900"
  ></div> -->
</template>
