import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Carteira do Dragão',
        short_name: 'Carteira',
        description: 'Controle offline de moedas para seus personagens.',
        theme_color: '#22170f',
        background_color: '#f5eddc',
        display: 'standalone',
        lang: 'pt-BR',
        icons: [
          { src: 'dragon-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'dragon-mark.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      }
    })
  ]
})
