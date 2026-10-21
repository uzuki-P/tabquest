import { useCallback, useEffect, useState } from "react"

import { CheckIcon, PlusIcon, XIcon } from "@phosphor-icons/react"

import type { BillFormApi } from "@/components/bill-form-sections"
import { PersonAvatar } from "@/components/person-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { PlayerFormValue } from "@/lib/bill-form"

/**
 * "Who's in this order" section for the bill form. Shows the whole player
 * directory as avatar chips that toggle people in and out of the order;
 * typing a name that is not in the directory offers to create the player.
 * Each row keeps a stable key, so swapping a player never disturbs the
 * allocation matrix targeting that row.
 */

interface PlayerOption {
  id: string
  name: string
}

/** The slice of the billPlayers array-field API the picker needs. */
interface BillPlayerFieldApi {
  state: { value: PlayerFormValue[] }
  pushValue: (value: PlayerFormValue) => void
  removeValue: (index: number) => void
  replaceValue: (index: number, value: PlayerFormValue) => void
}

export function PlayersPickerSection({ form }: { form: BillFormApi }) {
  const [directory, setDirectory] = useState<PlayerOption[]>([])
  const [query, setQuery] = useState("")
  const [warning, setWarning] = useState<string | null>(null)

  const refreshDirectory = useCallback(() => {
    fetch("/api/admin/players")
      .then((response) => (response.ok ? response.json() : { players: [] }))
      .then((body: { players?: PlayerOption[] }) =>
        setDirectory(body.players ?? [])
      )
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshDirectory()
  }, [refreshDirectory])

  const trimmed = query.trim().toLowerCase()
  const visiblePlayers = trimmed
    ? directory.filter((player) => player.name.toLowerCase().includes(trimmed))
    : directory
  const exactMatch = directory.some(
    (player) => player.name.toLowerCase() === trimmed
  )

  function togglePlayerVia(field: BillPlayerFieldApi, player: PlayerOption) {
    const existing = field.state.value.findIndex(
      (p) => p.playerId === player.id
    )
    if (existing >= 0) {
      setWarning(null)
      field.removeValue(existing)
      return
    }
    setWarning(null)
    field.pushValue({
      key: crypto.randomUUID(),
      alias: player.name,
      playerId: player.id,
    })
  }

  function quickCreateVia(field: BillPlayerFieldApi, name: string) {
    void (async () => {
      const response = await fetch("/api/admin/players", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          message?: string
        }
        setWarning(body.message ?? "Creating the player failed.")
        return
      }
      const body = (await response.json()) as {
        player: { id: string; name: string }
      }
      setDirectory((current) =>
        [...current, body.player].sort((a, b) => a.name.localeCompare(b.name))
      )
      setWarning(null)
      field.pushValue({
        key: crypto.randomUUID(),
        alias: body.player.name,
        playerId: body.player.id,
      })
      setQuery("")
    })()
  }

  function addAllVia(field: BillPlayerFieldApi, players: PlayerOption[]) {
    setWarning(null)
    for (const player of players) {
      if (field.state.value.some((p) => p.playerId === player.id)) continue
      field.pushValue({
        key: crypto.randomUUID(),
        alias: player.name,
        playerId: player.id,
      })
    }
  }

  function removeAllVia() {
    setWarning(null)
    form.setFieldValue("billPlayers", [])
  }

  return (
    <form.Field name="billPlayers" mode="array">
      {(field) => (
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="player-filter">People in the directory</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visiblePlayers.length === 0}
                  title={
                    trimmed
                      ? "Add everyone matching the filter"
                      : "Add everyone from the directory"
                  }
                  onClick={() => addAllVia(field, visiblePlayers)}
                >
                  Add all
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={field.state.value.length === 0}
                  onClick={() => removeAllVia()}
                >
                  Remove all
                </Button>
              </div>
            </div>
            <Input
              id="player-filter"
              type="search"
              placeholder="Filter by name, e.g. Bu Tari"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {directory.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                The directory is empty. Type a name above to create the first
                player.
              </p>
            ) : visiblePlayers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No directory name matches &ldquo;{query.trim()}&rdquo;.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {visiblePlayers.map((player) => {
                  const inOrder = field.state.value.some(
                    (p) => p.playerId === player.id
                  )
                  return (
                    <button
                      key={player.id}
                      type="button"
                      aria-pressed={inOrder}
                      onClick={() => togglePlayerVia(field, player)}
                      className={`flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-sm transition-colors ${
                        inOrder
                          ? "border-primary bg-primary text-primary-foreground"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <PersonAvatar name={player.name} size="sm" />
                      <span className="max-w-40 truncate">{player.name}</span>
                      {/* Always rendered at full size so picking a person
                          never shifts the neighbouring chips. */}
                      <CheckIcon
                        weight="bold"
                        aria-hidden
                        className={`size-3.5 ${inOrder ? "" : "invisible"}`}
                      />
                    </button>
                  )
                })}
              </div>
            )}
            {trimmed !== "" && !exactMatch && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => quickCreateVia(field, query.trim())}
              >
                <PlusIcon weight="bold" />
                Create player &ldquo;{query.trim()}&rdquo;
              </Button>
            )}
          </div>

          {warning && (
            <p role="alert" className="text-sm text-destructive">
              {warning}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {field.state.value.map((billPlayer, index) => (
              <form.Subscribe
                key={billPlayer.key}
                selector={(state) =>
                  state.values.billPlayers[index]?.alias ?? ""
                }
              >
                {(alias) => (
                  <BillPlayerTile
                    form={form}
                    index={index}
                    alias={alias}
                    onRemove={() => {
                      setWarning(null)
                      field.removeValue(index)
                    }}
                  />
                )}
              </form.Subscribe>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Everyone on a bill comes from your players. Type a new name in the
            filter box to create one on the spot.
          </p>
        </div>
      )}
    </form.Field>
  )
}

function BillPlayerTile({
  form,
  onRemove,
  index,
  alias,
}: {
  form: BillFormApi
  onRemove: () => void
  index: number
  alias: string
}) {
  // The alias arrives through a subscription in the parent, so live edits
  // keep the avatar and save button current.
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <div className="flex items-center gap-3">
        <PersonAvatar name={alias} size="lg" />
        <div className="min-w-0 grow">
          <form.Field name={`billPlayers[${index}].alias`}>
            {(sub) => (
              <Input
                id={sub.name}
                aria-label={`Name for person ${index + 1}`}
                placeholder="Name this person"
                className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-1"
                value={sub.state.value}
                onChange={(event) => sub.handleChange(event.target.value)}
              />
            )}
          </form.Field>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`Remove ${alias || "person"}`}
          onClick={onRemove}
        >
          <XIcon />
        </Button>
      </div>
    </div>
  )
}
