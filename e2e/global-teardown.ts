import { cleanupFixture } from './helpers/seed'
import { cleanupHorasFixture } from './helpers/seed-horas'

export default async function globalTeardown() {
  await cleanupFixture()
  await cleanupHorasFixture()
}
