/**
 * What the server and the app agree on: the API's shapes and checks (api), how documents are named
 * (docs), each person's home document (home), files (files), and the models of lists, notes and voice
 * memos.
 *
 * The source is used as it is (no build step): Vite bundles it into the app, esbuild into the server.
 */
export * from "./api";
export * from "./docs";
export * from "./files";
export * from "./home";
export * from "./lists";
export * from "./memos";
export * from "./notes";
