// ID de miembro de Slack de una persona (profiles.slack_id, migración 0050): lo que los
// flujos de Zapier/n8n usan para mencionarla (<@U…>) o escribirle por mensaje directo.
//
// Solo vale el ID de MIEMBRO: empieza por U (o W, usuarios de Enterprise Grid) y sigue con
// mayúsculas y dígitos. Un handle (@laura), un nombre visible o el ID de un canal (C…) no
// sirven para mencionar, y si se colaran el mensaje saldría sin mención y sin ningún error
// visible. La misma regla la impone un CHECK en la base; aquí se valida antes para dar un
// error claro en el formulario. Pura: la usan las acciones de usuarios y sus tests.

export const PATRON_SLACK_ID = /^[UW][A-Z0-9]{8,}$/

export type SlackIdNormalizado = { ok: true; valor: string | null } | { ok: false }

export function normalizarSlackId(raw: string | null | undefined): SlackIdNormalizado {
  // Lo que suele traer un pegado: espacios o saltos de línea alrededor, y a veces
  // minúsculas si se tecleó a mano. Eso se arregla; lo demás no se adivina.
  const valor = (raw ?? '').trim().toUpperCase()
  if (!valor) return { ok: true, valor: null } // vacío = sin asignar
  return PATRON_SLACK_ID.test(valor) ? { ok: true, valor } : { ok: false }
}

export const AYUDA_SLACK_ID = 'En Slack: perfil de la persona → ⋮ (más) → «Copiar ID de miembro». Empieza por U, p. ej. U01ABCD2EFG.'
