import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Enable React and Tailwind processing for development and builds.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
