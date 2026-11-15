import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { App } from "./App";
import { server } from "./lib/api";
import { HouseholdProvider } from "./lib/household";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

// Android's back button: back through the app's pages, and out of the app from the first one (as before
// @capacitor/app, which otherwise does nothing there).
if (Capacitor.getPlatform() === "android") {
  void NativeApp.addListener("backButton", ({ canGoBack }) => (canGoBack ? history.back() : void NativeApp.exitApp()));
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HouseholdProvider base={server.load()}>
      <I18nProvider>
        <App />
      </I18nProvider>
    </HouseholdProvider>
  </StrictMode>,
);
