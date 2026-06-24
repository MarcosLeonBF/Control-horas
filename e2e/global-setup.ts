import { chromium } from '@playwright/test'
import { seedManagerFixture } from './helpers/seed'
import fs from 'node:fs'

export default async function globalSetup() {
  const fixture = await seedManagerFixture()
  fs.mkdirSync('e2e/.auth', { recursive: true })
  fs.writeFileSync('e2e/.fixture.json', JSON.stringify(fixture))

  // Login real por UI → guarda storageState
  const browser = await chromium.launch()
  const page = await browser.newPage({ baseURL: 'http://localhost:3000' })
  await page.goto('/login')
  await page.getByLabel('Email').fill(fixture.managerEmail)
  await page.getByLabel('Contraseña').fill(fixture.managerPassword)
  await page.getByRole('button', { name: /ingresar/i }).click()
  await page.waitForURL('**/presupuestos')
  await page.context().storageState({ path: 'e2e/.auth/manager.json' })
  await browser.close()
}
