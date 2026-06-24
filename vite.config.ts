import path from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: { port: Number(process.env.PORT) || 5174 },
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
})
