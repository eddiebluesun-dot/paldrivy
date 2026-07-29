export function normalizeConversationPair(
  userIdA: string,
  userIdB: string,
): { user_a: string; user_b: string } {
  return userIdA < userIdB
    ? { user_a: userIdA, user_b: userIdB }
    : { user_a: userIdB, user_b: userIdA };
}
