import { createFileRoute, notFound } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { PlayerProfile } from "@/components/player-profile"
import { PlayerProfileSkeleton } from "@/components/page-skeletons"
import { getServerContext } from "@/server/context"
import { getPlayerProfile } from "@/server/services/insights"

const fetchPlayerProfile = createServerFn({ method: "GET" })
  .validator((playerId: string) => playerId)
  .handler(async ({ data }) => {
    const ctx = await getServerContext()
    return Effect.runPromise(getPlayerProfile({ db: ctx.db }, data))
  })

export const Route = createFileRoute("/players/$playerId")({
  loader: async ({ params }) => {
    const profile = await fetchPlayerProfile({ data: params.playerId })
    if (!profile) throw notFound()
    return profile
  },
  component: PlayerProfilePage,
  pendingComponent: PlayerProfileSkeleton,
})

function PlayerProfilePage() {
  const profile = Route.useLoaderData()
  return <PlayerProfile profile={profile} />
}
