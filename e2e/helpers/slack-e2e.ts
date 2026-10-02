// ID de Slack para los usuarios que crean los E2E por el formulario de alta, donde es
// obligatorio. Tiene que ser único (índice de la 0050) y con el formato de un ID de miembro;
// el cleanup de e2e-nuevo-* borra al usuario y con él su ID.
export function slackE2E(): string {
  return `UE2E${Date.now()}${Math.floor(Math.random() * 1000)}`
}
