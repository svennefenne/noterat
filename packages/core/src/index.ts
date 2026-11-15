/**
 * What the server and the app agree on: the API's shapes and checks (api), how documents are named
 * (docs), each person's home document (home), files (files), the models of lists, notes, voice memos
 * and journal entries, scans and receipts, recipes, what's transcribed where (transcripts), and what's searchable
 * (search).
 *
 * The source is used as it is (no build step): Vite bundles it into the app, esbuild into the server.
 */
export * from "./api";
export * from "./calendar";
export * from "./budget";
export * from "./csv";
export * from "./docs";
export * from "./files";
export * from "./home";
export * from "./ingredients";
export * from "./journal";
export * from "./lists";
export * from "./memos";
export * from "./notes";
export * from "./receipts";
export * from "./recipes";
export * from "./scans";
export * from "./schemaorg";
export * from "./search";
export * from "./transcripts";
