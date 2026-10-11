import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Libraries that change far less often than the app get their own chunks, so a
// deploy only invalidates the app code and browsers keep these cached. Each
// group is either needed on every page anyway (react, ui-utils, supabase,
// date-fns) or only by the pages that already load it (charts). Radix is left
// to Rollup on purpose: one radix group put every page's widgets (menus, tabs,
// scroll areas) into the first download.
//
// Rollup moves an unassigned dependency of a group into that group, so a
// library shared by the charts and every page (clsx, used by cn()) has to be
// claimed by an always-loaded group first, or every page downloads the charts.
const VENDOR_CHUNKS: [string, RegExp][] = [
  ["react", /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/],
  ["ui-utils", /[\\/]node_modules[\\/](clsx|tailwind-merge|class-variance-authority)[\\/]/],
  ["supabase", /[\\/]node_modules[\\/]@supabase[\\/]/],
  ["charts", /[\\/]node_modules[\\/](recharts|recharts-scale|react-smooth|victory-vendor|d3-[^\\/]+|internmap|decimal\.js-light|lodash)[\\/]/],
  ["date-fns", /[\\/]node_modules[\\/]date-fns[\\/]/],
];

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Rollup's CommonJS interop helper is shared by every CommonJS
          // package (react among them); left unassigned it lands in whichever
          // group asks first, which was the charts.
          if (id.includes("commonjsHelpers")) return "react";
          return VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id))?.[0];
        },
      },
    },
  },
});
