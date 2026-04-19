const MODE = import.meta.env.MODE;
const BASE_URL = import.meta.env.BASE_URL;
const PROD = import.meta.env.PROD;
const DEV = import.meta.env.DEV;
const SSR = import.meta.env.SSR;
const CLERK = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const env = [
  ["MODE", MODE],
  ["BASE_URL", BASE_URL],
  ["PROD", PROD],
  ["DEV", DEV],
  ["SSR", SSR],
  ["VITE_CLERK_PUBLISHABLE_KEY", CLERK],
];
// console.log("env", env);

import { createApp } from "vue";
import App from "./App.vue";

/**
 * GraphQL
 */
import { DefaultApolloClient } from "@vue/apollo-composable";
import {
  ApolloClient,
  InMemoryCache,
  createHttpLink,
} from "@apollo/client/core";
import { resolveApiBase } from "./ping_check";

/**
 * Pinia — cross-page introspection query state (spec-cross_page_introspection_query_state.md)
 */
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";

/**
 * Bootstrap
 */
import "./assets/main.scss";
import "bootstrap";

(async () => {
  const base = await resolveApiBase();

  const httpLink = createHttpLink({ uri: `${base}/graphql/` });
  // Cache implementation
  const cache = new InMemoryCache();
  // Create the apollo client
  const apolloClient = new ApolloClient({ link: httpLink, cache });

  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  const app = createApp(App);
  app.provide(DefaultApolloClient, apolloClient);
  app.use(pinia);
  app.mount("#app");
  window.app = app;
})();
