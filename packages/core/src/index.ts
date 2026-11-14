/**
 * What the server and the app agree on: the API's shapes and checks (api), how documents are named
 * (docs), each person's home document (home), and the lists' model (lists).
 *
 * The source is used as it is (no build step): Vite bundles it into the app, esbuild into the server.
 */
export * from "./api";
export * from "./docs";
export * from "./home";
export * from "./lists";
