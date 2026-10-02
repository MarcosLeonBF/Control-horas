// Campos obligatorios del alta de usuario. Se comprueban antes de tocar nada: el usuario de
// auth se crea antes que el perfil, y un alta que fallara a medias dejaría uno a medio hacer.
// Puro, para poder probarlo sin la base.
export function errorCamposAlta(i: { full_name: string; email: string; password: string; slackId: string }): string | null {
  if (!i.full_name.trim() || !i.email.trim() || i.password.length < 8) {
    return 'Nombre, correo y contraseña (mín. 8) son obligatorios.'
  }
  // Sin él, los avisos no pueden mencionar a la persona ni escribirle por mensaje directo.
  // Solo en el alta: al editar sigue siendo opcional, porque hay perfiles anteriores sin él.
  if (!i.slackId.trim()) return 'El ID de Slack es obligatorio.'
  return null
}
