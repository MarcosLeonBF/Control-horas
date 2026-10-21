// Badge por tono de estado, sobre los --status-* de globals.css. Lo comparten los estados de
// bancos y de HUCHA y las acciones de auditoría: crear = disponible, editar = bajo, anular = excedido.
export const TONO = {
  disponible: 'bg-(--status-disponible)/10 text-(--status-disponible) ring-(--status-disponible)/25',
  bajo: 'bg-(--status-bajo)/10 text-(--status-bajo) ring-(--status-bajo)/25',
  consumido: 'bg-(--status-consumido)/10 text-(--status-consumido) ring-(--status-consumido)/25',
  excedido: 'bg-(--status-excedido)/10 text-(--status-excedido) ring-(--status-excedido)/25',
  sin: 'bg-muted text-muted-foreground ring-(--status-sin)/25',
}
