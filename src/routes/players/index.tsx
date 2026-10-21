import { createFileRoute } from "@tanstack/react-router"
import { createServerFn } from "@tanstack/react-start"
import { Effect } from "effect"

import { PlayerDirectory } from "@/components/player-directory"
import { PlayersSkeleton } from "@/components/page-skeletons"
import { getServerContext } from "@/server/context"
import { listPlayerBoard } from "@/server/services/insights"

const fetchPlayerBoard = createServerFn({ method: "GET" }).handler(async () => {
  const ctx = await getServerContext()
  return Effect.runPromise(listPlayerBoard({ db: ctx.db }))
})

export const Route = createFileRoute("/players/")({
  loader: () => fetchPlayerBoard(),
  component: PlayersPage,
  pendingComponent: PlayersSkeleton,
})

function PlayersPage() {
  const board = Route.useLoaderData()
  return <PlayerDirectory board={board} />
}
