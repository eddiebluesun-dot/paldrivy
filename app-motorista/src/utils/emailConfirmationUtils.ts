export function emailsMatch(email: string, emailConfirm: string): boolean {
  const a = email.trim().toLowerCase();
  const b = emailConfirm.trim().toLowerCase();
  if (!a || !b) return false;
  return a === b;
}
