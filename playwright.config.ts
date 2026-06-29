import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    {
      name: 'node-hucha',
      testMatch: ['**/hucha-sync.spec.ts'],
    },
    {
      name: 'node-horas',
      testMatch: ['**/horas-alertas.spec.ts'],
    },
    { name: 'chromium', use: { storageState: 'e2e/.auth/manager.json' }, testIgnore: ['**/horas-*.spec.ts', '**/hucha-sync.spec.ts', '**/hucha-sync-ui.spec.ts', '**/hucha-admin-*.spec.ts'] },
    {
      name: 'chromium-horas',
      use: { storageState: 'e2e/.auth/operativo.json' },
      testMatch: '**/horas-*.spec.ts',
      testIgnore: ['**/horas-alta-usuario.spec.ts', '**/horas-equipo.spec.ts', '**/horas-bancos*.spec.ts', '**/horas-reportes.spec.ts', '**/horas-alertas.spec.ts', '**/horas-usuarios-editar.spec.ts'],
    },
    {
      name: 'chromium-horas-admin',
      use: { storageState: 'e2e/.auth/admin-horas.json' },
      testMatch: ['**/horas-alta-usuario.spec.ts', '**/horas-equipo.spec.ts', '**/horas-bancos*.spec.ts', '**/horas-reportes.spec.ts', '**/horas-usuarios-editar.spec.ts', '**/hucha-sync-ui.spec.ts', '**/hucha-admin-*.spec.ts'],
    },
  ],
  // Sin bloque `webServer`: el dev server lo gestiona el usuario.
  // Antes de correr E2E debe estar levantado en http://localhost:3000.
})
