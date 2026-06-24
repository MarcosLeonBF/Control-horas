import { cleanupFixture } from './helpers/seed'

export default async function globalTeardown() {
  await cleanupFixture()
}
