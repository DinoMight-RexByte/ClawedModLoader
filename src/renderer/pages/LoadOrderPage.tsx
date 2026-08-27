import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronsDown,
  ChevronsUp,
  CheckCircle2,
  GripVertical,
  Search
} from "lucide-react";
import type { DragEvent, KeyboardEvent, ReactElement } from "react";
import { Fragment } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  LoadOrderActionResult,
  LoadOrderEntry,
  LoadOrderSnapshot
} from "../../shared/contracts/app";
import { ProblemDetails } from "../components/ProblemDetails";
import { useAppStore } from "../stores/appStore";

type EntryFilter = "all" | "enabled" | "disabled";
type DropPlacement = "before" | "after";
type DropTarget = { modId: string; placement: DropPlacement };

export function LoadOrderPage(): ReactElement {
  const profileRevision = useAppStore((state) => state.profileRevision);
  const bumpProfileRevision = useAppStore((state) => state.bumpProfileRevision);
  const [snapshot, setSnapshot] = useState<LoadOrderSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<EntryFilter>("all");
  const [busy, setBusy] = useState(false);
  const [draggedModId, setDraggedModId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshSnapshot = useCallback(async () => {
    setSnapshot(await window.cmm.getLoadOrderSnapshot());
  }, []);

  useEffect(() => {
    void refreshSnapshot().catch(() => {
      setError("Load order is unavailable.");
    });
  }, [profileRevision, refreshSnapshot]);

  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);
  const filteredEntries = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesSearch =
        normalizedSearch.length === 0 ||
        [
          entry.mod.name,
          entry.mod.id,
          entry.mod.author,
          entry.mod.version,
          entry.mod.loader
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);
      const matchesState =
        filter === "all" ||
        (filter === "enabled" && entry.enabled) ||
        (filter === "disabled" && !entry.enabled);

      return matchesSearch && matchesState;
    });
  }, [entries, filter, search]);

  const runOrderAction = async (
    action: () => Promise<LoadOrderActionResult>
  ) => {
    setBusy(true);
    setError(null);

    try {
      const result = await action();
      setSnapshot(result.snapshot);
      setMessage(
        result.status === "ok"
          ? "Load order updated."
          : "Load order action did not complete."
      );
      if (result.status === "ok") {
        bumpProfileRevision();
      }
      if (result.problems.length) {
        setError(result.problems[0].message);
      }
    } catch {
      setError("The load order action could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  const submitPosition = (entry: LoadOrderEntry, rawValue: string): void => {
    const position = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(position)) {
      return;
    }

    void runOrderAction(() =>
      window.cmm.setModActiveOrderPosition({
        modId: entry.mod.id,
        position
      })
    );
  };

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    entry: LoadOrderEntry
  ): void => {
    if (!event.altKey) {
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      void runOrderAction(() =>
        window.cmm.moveModInActiveOrder({
          modId: entry.mod.id,
          direction: "up"
        })
      );
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      void runOrderAction(() =>
        window.cmm.moveModInActiveOrder({
          modId: entry.mod.id,
          direction: "down"
        })
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      void runOrderAction(() =>
        window.cmm.moveModInActiveOrder({
          modId: entry.mod.id,
          direction: "top"
        })
      );
    } else if (event.key === "End") {
      event.preventDefault();
      void runOrderAction(() =>
        window.cmm.moveModInActiveOrder({
          modId: entry.mod.id,
          direction: "bottom"
        })
      );
    }
  };

  const clearDragState = (): void => {
    setDraggedModId(null);
    setDropTarget(null);
  };

  const getEntryDropPlacement = (
    event: DragEvent<HTMLElement>
  ): DropPlacement => {
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  };

  const activateDropTarget = (
    entry: LoadOrderEntry,
    placement: DropPlacement
  ): void => {
    if (draggedModId && draggedModId !== entry.mod.id) {
      setDropTarget({ modId: entry.mod.id, placement });
    }
  };

  const placeDraggedMod = (
    event: DragEvent<HTMLElement>,
    entry: LoadOrderEntry,
    placement: DropPlacement
  ): void => {
    event.preventDefault();
    const sourceModId = event.dataTransfer.getData("text/plain") || draggedModId;
    clearDragState();

    if (!sourceModId || sourceModId === entry.mod.id) {
      return;
    }

    void runOrderAction(() =>
      window.cmm.placeModInActiveOrder({
        modId: sourceModId,
        targetModId: entry.mod.id,
        placement
      })
    );
  };

  const renderDropZone = (
    entry: LoadOrderEntry,
    placement: DropPlacement
  ): ReactElement => {
    const active =
      dropTarget?.modId === entry.mod.id && dropTarget.placement === placement;

    return (
      <div
        aria-hidden="true"
        className="flex h-3 items-center px-4"
        data-drop-mod-id={entry.mod.id}
        data-drop-placement={placement}
        data-testid={`load-order-drop-${entry.mod.id}-${placement}`}
        onDragOver={(event) => {
          event.preventDefault();
          activateDropTarget(entry, placement);
        }}
        onDrop={(event) => placeDraggedMod(event, entry, placement)}
      >
        <div
          className={`h-0.5 w-full rounded-full ${
            active ? "bg-app-accent" : "bg-transparent"
          }`}
        />
      </div>
    );
  };

  const activeProfileName = snapshot?.activeProfile.name ?? "Loading";

  return (
    <div className="flex flex-1 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-app-accent">Load Order</p>
          <h1 className="mt-1 text-3xl font-semibold">Logical Order</h1>
          <p className="mt-2 text-sm text-app-muted">
            Active profile: {activeProfileName}
          </p>
        </div>
        <div
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold ${
            snapshot?.validation.validity === "invalid"
              ? "border-app-danger/40 bg-app-danger/10 text-app-danger"
              : "border-app-success/40 bg-app-success/10 text-app-success"
          }`}
        >
          {snapshot?.validation.validity === "invalid" ? (
            <AlertTriangle aria-hidden="true" size={18} />
          ) : (
            <CheckCircle2 aria-hidden="true" size={18} />
          )}
          {snapshot?.validation.validity ?? "unknown"}
        </div>
      </header>

      <section className="grid gap-3 rounded-lg border border-app-border bg-app-surface p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <label className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-2.5 text-app-subtle"
              size={18}
            />
            <span className="sr-only">Search load order</span>
            <input
              className="h-10 w-full rounded-md border border-app-border bg-app-surfaceRaised pl-10 pr-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search ordered mods"
              value={search}
            />
          </label>
          <select
            aria-label="Load order enabled filter"
            className="h-10 rounded-md border border-app-border bg-app-surfaceRaised px-3 text-sm text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
            onChange={(event) => setFilter(event.target.value as EntryFilter)}
            value={filter}
          >
            <option value="all">All states</option>
            <option value="enabled">Enabled</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
      </section>

      {message || error ? (
        <section
          className={`rounded-lg border p-4 text-sm ${
            error
              ? "border-app-danger/40 bg-app-danger/10 text-app-danger"
              : "border-app-border bg-app-surface"
          }`}
          role={error ? "alert" : "status"}
        >
          {error ?? message}
        </section>
      ) : null}

      <section className="rounded-lg border border-app-border bg-app-surface p-4">
        <h2 className="text-base font-semibold">Validation</h2>
        <div className="mt-3">
          {snapshot?.validation.problems.length ? (
            <ProblemDetails problems={snapshot.validation.problems} />
          ) : (
            <div className="flex items-center gap-2 text-sm text-app-muted">
              <CheckCircle2
                aria-hidden="true"
                className="text-app-success"
                size={18}
              />
              No load-order problems reported.
            </div>
          )}
        </div>
      </section>

      {snapshot && filteredEntries.length === 0 ? (
        <section className="rounded-lg border border-app-border bg-app-surface p-8 text-center">
          <h2 className="text-lg font-semibold">No ordered mods to show</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-app-muted">
            Enable mods from the active profile or adjust the current filters.
          </p>
        </section>
      ) : null}

      {filteredEntries.length ? (
        <section className="grid">
          {filteredEntries.map((entry, index) => (
            <Fragment key={`${entry.mod.id}-${entry.mod.version}`}>
              {index === 0 ? renderDropZone(entry, "before") : null}
              <article
                aria-label={`${entry.mod.name} load order position ${entry.position}`}
                aria-roledescription="Draggable load-order item"
                className={`relative rounded-lg border p-4 outline-none ${
                  draggedModId === entry.mod.id
                    ? "border-app-accent bg-app-accent/10"
                    : "border-app-border bg-app-surface"
                }`}
                data-mod-id={entry.mod.id}
                data-testid={`load-order-item-${entry.mod.id}`}
                draggable={!busy}
                onDragEnd={clearDragState}
                onDragOver={(event) => {
                  event.preventDefault();
                  activateDropTarget(entry, getEntryDropPlacement(event));
                }}
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", entry.mod.id);
                  setDraggedModId(entry.mod.id);
                }}
                onDrop={(event) => {
                  const placement =
                    dropTarget?.modId === entry.mod.id
                      ? dropTarget.placement
                      : getEntryDropPlacement(event);
                  placeDraggedMod(event, entry, placement);
                }}
                onKeyDown={(event) => handleRowKeyDown(event, entry)}
                tabIndex={0}
              >
                {dropTarget?.modId === entry.mod.id ? (
                  <div
                    className={`pointer-events-none absolute left-4 right-4 h-0.5 rounded-full bg-app-accent ${
                      dropTarget.placement === "before" ? "top-0" : "bottom-0"
                    }`}
                  />
                ) : null}
                <div className="grid gap-4 lg:grid-cols-[48px_1fr_auto]">
                  <div
                    className="flex cursor-grab items-center gap-2 text-app-muted active:cursor-grabbing"
                    title="Drag to reorder"
                  >
                    <GripVertical aria-label="Drag handle" size={18} />
                    <span className="w-8 text-right text-sm tabular-nums">
                      {entry.position}
                    </span>
                  </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold">{entry.mod.name}</h2>
                    <span className="rounded bg-app-surfaceRaised px-2 py-1 text-xs uppercase text-app-muted">
                      {entry.mod.loader}
                    </span>
                    <span
                      className={`rounded px-2 py-1 text-xs font-semibold ${
                        entry.enabled
                          ? "bg-app-success/10 text-app-success"
                          : "bg-app-surfaceRaised text-app-muted"
                      }`}
                    >
                      {entry.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-app-muted">
                    {entry.mod.id} / {entry.selectedVersion}
                  </div>
                  {entry.problems.length ? (
                    <div className="mt-3">
                      <ProblemDetails problems={entry.problems} />
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  <button
                    aria-label={`Move ${entry.mod.name} to top`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy || entry.position === 1}
                    onClick={() =>
                      void runOrderAction(() =>
                        window.cmm.moveModInActiveOrder({
                          modId: entry.mod.id,
                          direction: "top"
                        })
                      )
                    }
                    type="button"
                  >
                    <ChevronsUp aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`Move ${entry.mod.name} up`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy || entry.position === 1}
                    onClick={() =>
                      void runOrderAction(() =>
                        window.cmm.moveModInActiveOrder({
                          modId: entry.mod.id,
                          direction: "up"
                        })
                      )
                    }
                    type="button"
                  >
                    <ArrowUp aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`Move ${entry.mod.name} down`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy || entry.position === entries.length}
                    onClick={() =>
                      void runOrderAction(() =>
                        window.cmm.moveModInActiveOrder({
                          modId: entry.mod.id,
                          direction: "down"
                        })
                      )
                    }
                    type="button"
                  >
                    <ArrowDown aria-hidden="true" size={16} />
                  </button>
                  <button
                    aria-label={`Move ${entry.mod.name} to bottom`}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-app-border text-app-muted hover:bg-app-surfaceRaised hover:text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent disabled:opacity-60"
                    disabled={busy || entry.position === entries.length}
                    onClick={() =>
                      void runOrderAction(() =>
                        window.cmm.moveModInActiveOrder({
                          modId: entry.mod.id,
                          direction: "bottom"
                        })
                      )
                    }
                    type="button"
                  >
                    <ChevronsDown aria-hidden="true" size={16} />
                  </button>
                  <label>
                    <span className="sr-only">
                      Numeric position for {entry.mod.name}
                    </span>
                    <input
                      className="h-9 w-16 rounded-md border border-app-border bg-app-surfaceRaised px-2 text-center text-sm tabular-nums text-app-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-app-accent"
                      defaultValue={entry.position}
                      key={`${entry.mod.id}-${entry.position}`}
                      min={1}
                      onBlur={(event) =>
                        submitPosition(entry, event.currentTarget.value)
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          submitPosition(entry, event.currentTarget.value);
                        }
                      }}
                      type="number"
                    />
                  </label>
                </div>
              </div>
            </article>
              {renderDropZone(entry, "after")}
            </Fragment>
          ))}
        </section>
      ) : null}
    </div>
  );
}
