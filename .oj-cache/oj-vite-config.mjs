// .lovable/vite.config.ts
import { defineConfig as defineConfig2 } from "vite";

// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { componentTagger } from "lovable-tagger";
var vite_config_default = defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false
    }
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react-dom/client"]
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve("/dev-server/.lovable", "./src")
    }
  }
}));

// .lovable/vite.config.ts
import { componentTagger as componentTagger2 } from "lovable-tagger";
import { devServerBridgePlugin } from "@lovable.dev/vite-plugin-dev-server-bridge";
import { hmrGatePlugin } from "@lovable.dev/vite-plugin-hmr-gate";
var userConfig = vite_config_default;
var lovableTagger = componentTagger2();
var devServerBridge = devServerBridgePlugin();
var hmrGate = hmrGatePlugin();
var DEDUPE_PACKAGES = [
  "react",
  "react-dom",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "@tanstack/react-query",
  "@tanstack/query-core"
];
var vite_config_default2 = defineConfig2(async (configEnv) => {
  const resolvedConfig = typeof userConfig === "function" ? await userConfig(configEnv) : userConfig;
  const rawPlugins = resolvedConfig?.plugins;
  const plugins = Array.isArray(rawPlugins) ? rawPlugins : rawPlugins ? [rawPlugins] : [];
  const existingPlugins = plugins.filter(
    (p) => p?.name !== "lovable-tagger" && p?.name !== "lovable-dev-server-bridge" && p?.name !== "hmr-gate"
  );
  const existingDedupe = resolvedConfig?.resolve?.dedupe ?? [];
  const dedupe = [.../* @__PURE__ */ new Set([...existingDedupe, ...DEDUPE_PACKAGES])];
  return {
    ...resolvedConfig,
    plugins: [...existingPlugins, devServerBridge, lovableTagger, hmrGate],
    server: {
      ...resolvedConfig?.server
    },
    resolve: {
      ...resolvedConfig?.resolve,
      dedupe
    }
  };
});
export {
  vite_config_default2 as default
};
