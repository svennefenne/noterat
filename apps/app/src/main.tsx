import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as NativeApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { App } from "./App";
import { server } from "./lib/api";
import { closeTop } from "./lib/back";
import { HouseholdProvider } from "./lib/household";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

// Android's back button: what's open over the page closed first, then back through the app's pages,
// and out of the app from the first one (as before @capacitor/app, which otherwise does nothing there).
if (Capacitor.getPlatform() === "android") {
  void NativeApp.addListener("backButton", ({ canGoBack }) => {
    if (closeTop()) return;
    if (canGoBack) history.back();
    else void NativeApp.exitApp();
  });
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
