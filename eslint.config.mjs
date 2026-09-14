import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".vercel/**",
    "out/**",
    "output/**",
    "build/**",
    "next-env.d.ts",
    "docs/**",
    ".agents/**",
    "convex/_generated/**",
    "convex/betterAuth/_generated/**",
  ])
]);
