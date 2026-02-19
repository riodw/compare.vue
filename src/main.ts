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
console.log("env", env);

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
// HTTP connection to the API
const httpLink = createHttpLink({
  // You should use an absolute URL here
  uri:
    (PROD ? "https://compare-django.onrender.com" : "http://127.0.0.1:8000") +
    "/graphql/",
});
// Cache implementation
const cache = new InMemoryCache();
// Create the apollo client
const apolloClient = new ApolloClient({
  link: httpLink,
  cache,
});

/**
 * Bootstrap
 */
import "./assets/main.scss";
import "bootstrap";

// Create and mount app
const app = createApp(App);

app.provide(DefaultApolloClient, apolloClient);

app.mount("#app");
