// Solo los tests puros (sin navegador, sin servidor y sin base): se pueden correr en cualquier
// momento sin el globalSetup de playwright.config.ts, que siembra usuarios en la base
// compartida con producción (lib/avisos/entorno.ts).
//
//   npm run test:puros
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  projects: [
    {
      name: 'puros',
      testMatch: ['**/hub-*.spec.ts', '**/ruta-segura.spec.ts', '**/slack-id.spec.ts', '**/horas-alta-campos.spec.ts'],
    },
  ],
})
