// Dónde corre esto y a qué apuntan los enlaces. Solo producción envía avisos: hay una
// única base Supabase y la comparten el servidor local y los E2E.
export function esProduccion(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

export function appUrl(): string {
  const explicita = process.env.APP_URL?.trim()
  if (explicita) return explicita.replace(/\/+$/, '')
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim()
  return vercel ? `https://${vercel}` : 'http://localhost:3000'
}

export function enlaceBanco(proyecto: string): string {
  return `${appUrl()}/bancos/${encodeURIComponent(proyecto)}`
}

export function enlaceHucha(projectId: string): string {
  return `${appUrl()}/presupuestos/${projectId}`
}

// Un registro diario (time_log) concreto. Sin sesión, el login devuelve ahí al entrar.
export function enlaceRegistro(logId: string): string {
  return `${appUrl()}/registros/${logId}`
}

// Los usuarios que siembran los E2E nunca generan ni reciben avisos. Cualquier dominio
// .test (reservado para pruebas), no solo @horas.test: la siembra de HUCHA usa
// e2e-manager@hucha.test y la de sincronización e2e-sync-mgr-*@hucha.test.
export function esPersonaDePrueba(email: string | null | undefined): boolean {
  return /@[^@\s]+\.test$/i.test((email ?? '').trim())
}
