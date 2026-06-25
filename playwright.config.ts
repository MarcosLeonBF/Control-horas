import { defineConfig } from '@playwright/test'
import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { storageState: 'e2e/.auth/manager.json' }, testIgnore: '**/horas-*.spec.ts' },
    {
      name: 'chromium-horas',
      use: { storageState: 'e2e/.auth/operativo.json' },
      testMatch: '**/horas-*.spec.ts',
    },
  ],
  // Sin bloque `webServer`: el dev server lo gestiona el usuario.
  // Antes de correr E2E debe estar levantado en http://localhost:3000.
})
