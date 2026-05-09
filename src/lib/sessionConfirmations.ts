export function shouldRunDestructiveAction(
  confirmDestructiveActions: boolean,
  confirm: () => boolean,
) {
  return confirmDestructiveActions ? confirm() : true;
}
