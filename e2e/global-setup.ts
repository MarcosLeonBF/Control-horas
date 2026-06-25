import { chromium } from '@playwright/test'
import { seedManagerFixture } from './helpers/seed'
import { seedHorasFixture } from './helpers/seed-horas'
import fs from 'node:fs'

export default async function globalSetup() {
  fs.mkdirSync('e2e/.auth', { recursive: true })

  // ── HUCHA: seed manager ──────────────────────────────────────────────────
  const fixture = await seedManagerFixture()
  fs.writeFileSync('e2e/.fixture.json', JSON.stringify(fixture))

  const browser = await chromium.launch()

  // Login manager → presupuestos
  const managerPage = await browser.newPage({ baseURL: 'http://localhost:3000' })
  await managerPage.goto('/login')
  await managerPage.getByLabel('Email').fill(fixture.managerEmail)
  await managerPage.getByLabel('Contraseña').fill(fixture.managerPassword)
  await managerPage.getByRole('button', { name: /ingresar/i }).click()
  await managerPage.waitForURL('**/presupuestos')
  await managerPage.context().storageState({ path: 'e2e/.auth/manager.json' })
  await managerPage.close()

  // ── HORAS: seed operativo ────────────────────────────────────────────────
  const horasFixture = await seedHorasFixture()

  // Login operativo → /registrar
  const operativoPage = await browser.newPage({ baseURL: 'http://localhost:3000' })
  await operativoPage.goto('/login')
  await operativoPage.getByLabel('Email').fill(horasFixture.operativoEmail)
  await operativoPage.getByLabel('Contraseña').fill(horasFixture.operativoPassword)
  await operativoPage.getByRole('button', { name: /ingresar/i }).click()
  await operativoPage.waitForURL('**/registrar')
  await operativoPage.context().storageState({ path: 'e2e/.auth/operativo.json' })
  await operativoPage.close()

  await browser.close()
}
