import {defineConfig} from 'vite';
import {cloudflare} from '@cloudflare/vite-plugin';
export default defineConfig({plugins:[cloudflare({types:{includeRuntime:false},persistState:{path:"../output/payment-cloud-20261103/vite-state"}})],build:{outDir:'../output/payment-cloud-20261103/cloud-build'}});
