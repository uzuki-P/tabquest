/** Every ranked player links to their public profile. */
export function profileLink(playerId: string) {
  return {
    to: "/players/$playerId" as const,
    params: { playerId: playerId },
  }
}
