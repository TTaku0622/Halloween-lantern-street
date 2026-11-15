// @ts-check
import { defineConfig } from 'astro/config';

// src/ は Cloudflare の Worker（API）が使っているので、ページは site/ に置く
export default defineConfig({
  srcDir: './site',
  publicDir: './public',
  outDir: './dist',
  output: 'static',
});
