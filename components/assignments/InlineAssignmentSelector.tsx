"use client";

/**
 * Inline lead-assignment picker for the leads-dashboard table.
 *
 * ── Authorization summary (Phase 2W) ──────────────────────────────────────
 *  admin                  → can assign any non-admin user
 *  manager                → can assign SSE + SE inside their branches
 *  senior_sales_executive → can assign SE inside their branches
 *  sales_executive        → read-only badge / "Unassigned" (no UI)
 *
 * ── Phase 2N performance ───────────────────────────────────────────────────
 *  Candidates are a PROP, not a fetch. `LeadDashboardShell` owns the cache
 *  — one HTTP request per (branch, actor), shared across every row's
 *  selector. Previously each row fetched independently on first open,
 *  causing duplicate requests as the user opened popovers across rows.
 *
 * ── Why backend enforcement remains mandatory ──────────────────────────────
 *  The shell-side fetch is filtered server-side via `canAssignToUser` +
 *  `canAssignLeadToBranch`. The picker THEN posts to /api/assignments,
 *  which re-runs the SAME predicates — DevTools / curl cannot widen
 *  authority, only what the server already approved.
 *
 * The popover renders into a portal at document.body so the AG Grid cell's
 * `overflow:hidden` doesn't clip it. Position is computed from the trigger
 * button's bounding rect once on each open.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SessionUser } from "@/src/types/auth";
import type { AssignmentView } from "@/src/features/assignments/serializers";
import { ROLE_LABELS } from "@/src/features/auth/constants";
import { useDismissible } from "@/hooks/useDropdown";

interface Props {
  /** Branch/org name for this lead. */
  branch: string;
  /** Lead identifier — UUID from DB, or composite fallback. */
  leadId: string;
  /** Current assignment for this lead, if any. */
  existing: AssignmentView | null;
  /** The currently authenticated actor. Drives "can I assign at all?" UX. */
  actor: SessionUser;
  /**
   * Pre-filtered candidate users for this branch. Owned by the parent
   * (shell-level cache) — one fetch per branch, shared across rows.
   * Empty array is valid and just means "nobody assignable here yet".
   */
  candidates: SessionUser[];
  /**
   * Called after a successful create / reassign / unassign. Caller should
   * refresh the leads/assignments map so the row's badge updates.
   */
  onChanged: () => void;
}

type PopoverRect = { top: number; left: number; minWidth: number };

const CAN_ASSIGN_ROLES: ReadonlyArray<SessionUser["role"]> = [
  "super_admin",
  "tenant_admin",
  "org_admin",
  "admin",
  "org_manager",
  "manager",
  "senior_sales_executive",
];

export default function InlineAssignmentSelector({
  leadId,
  existing,
  actor,
  candidates,
  onChanged,
}: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [popoverRect, setPopoverRect] = useState<PopoverRect | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const canAssign = CAN_ASSIGN_ROLES.includes(actor.role);

  // Closes on outside-click + Esc. Portal needs both refs checked since
  // trigger and popover are separate DOM subtrees.
  useDismissible(open, [triggerRef, popoverRef], () => setOpen(false));

  // Open + measure popover position.
  const openPicker = () => {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const popoverHeight = 320;
    const popoverWidth = 280;
    // Always open above the button; clamp so it never goes off-screen top
    const top = Math.max(8, r.top - popoverHeight - 4);
    // Align to the right edge of the trigger; shift left if it would overflow
    const left = Math.min(
      Math.max(8, r.right - popoverWidth),
      window.innerWidth - popoverWidth - 8,
    );
    setPopoverRect({ top, left, minWidth: Math.max(r.width, popoverWidth) });
    setOpen(true);
  };

  // Recalculate position on scroll/resize while open.
  useEffect(() => {
    if (!open) return;
    const handler = () => {
      if (!triggerRef.current) return;
      const r = triggerRef.current.getBoundingClientRect();
      const popoverHeight = 320;
      const popoverWidth = 280;
      setPopoverRect({
        top: Math.max(8, r.top - popoverHeight - 4),
        left: Math.min(
          Math.max(8, r.right - popoverWidth),
          window.innerWidth - popoverWidth - 8,
        ),
        minWidth: Math.max(r.width, popoverWidth),
      });
    };
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
  }, [open]);

  const candidatesById = useMemo(() => {
    const m = new Map<string, SessionUser>();
    for (const u of candidates) m.set(u.id, u);
    return m;
  }, [candidates]);

  const filteredCandidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        (u.name ?? "").toLowerCase().includes(q),
    );
  }, [candidates, search]);

  // Phase 2U: prefer the denormalised assignee fields on the assignment
  // row itself — they're populated by the server-side `users` JOIN, so
  // we never have to fall back to displaying the raw UUID even when the
  // assignee isn't in this picker's candidate list (e.g., an admin viewing
  // an SE-owned lead from a branch they don't normally manage).
  const currentAssigneeLabel = (() => {
    if (!existing) return null;
    if (existing.assignee_name) return existing.assignee_name;
    if (existing.assignee_email) return existing.assignee_email;
    // Last-resort fallback: look up via candidates (covers stale rows
    // where the embed somehow returned null).
    const inList = candidatesById.get(existing.assigned_to);
    if (inList) return inList.name ?? inList.email;
    return "Unknown user";
  })();

  const assign = async (userId: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: userId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Failed to assign");
        return;
      }
      onChanged();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  const unassign = async () => {
    if (!existing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedUserId: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(data?.error ?? "Failed to unassign");
        return;
      }
      onChanged();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSaving(false);
    }
  };

  // ── Sales tier (rank 1): self-assign or unassign only ───────────────────
  // SE/sales_representative can claim an unassigned lead or release one they own.
  // They never see the full picker — the server also enforces this via the
  // leads list filter (only own + unassigned rows reach them at all).
  if (!canAssign && actor.rank > 0) {
    const isMyLead = !!existing && existing.assigned_to === actor.id;
    return (
      <div className="flex flex-col items-start gap-0.5">
        {isMyLead ? (
          <ReadonlyBadge label={currentAssigneeLabel ?? "You"} />
        ) : (
          <button
            type="button"
            onClick={() => assign(actor.id)}
            disabled={saving}
            className="rounded-full border border-dashed border-[#CBD5E1] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#475569] transition-colors hover:border-[#0b6cbf] hover:text-[#0b6cbf] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "+ Assign to me"}
          </button>
        )}
        {error && (
          <span className="block text-[10px] text-red-600">{error}</span>
        )}
      </div>
    );
  }

  // ── Truly read-only (rank 0 — read_only role) ────────────────────────────
  if (!canAssign) {
    return existing ? (
      <ReadonlyBadge label={currentAssigneeLabel ?? "Unknown user"} />
    ) : (
      <span className="text-[11px] italic text-[#94A3B8]">Unassigned</span>
    );
  }

  // ── Trigger + portaled popover ───────────────────────────────────────────
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setOpen(false) : openPicker())}
        disabled={saving}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={
          existing
            ? "flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#0b6cbf] transition-colors hover:bg-[#DBEAFE] disabled:cursor-not-allowed disabled:opacity-60"
            : "rounded-full border border-dashed border-[#CBD5E1] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#475569] transition-colors hover:border-[#0b6cbf] hover:text-[#0b6cbf] disabled:cursor-not-allowed disabled:opacity-60"
        }
      >
        {saving ? (
          <span className="inline-flex items-center gap-1">
            <span
              className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
            Saving…
          </span>
        ) : existing ? (
          <>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0b6cbf] text-[9px] font-bold text-white">
              {(currentAssigneeLabel ?? "?").charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[100px] truncate">
              {currentAssigneeLabel}
            </span>
          </>
        ) : (
          "+ Assign"
        )}
      </button>

      {open &&
        popoverRect &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label="Assign lead"
            style={{
              position: "fixed",
              top: popoverRect.top,
              left: popoverRect.left,
              minWidth: popoverRect.minWidth,
              maxWidth: 320,
              zIndex: 1000,
            }}
            className="overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-lg"
          >
            <div className="border-b border-[#F1F5F9] p-2">
              <input
                autoFocus
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search assignees…"
                className="w-full rounded-lg border border-[#E2E8F0] bg-white px-3 py-1.5 text-sm text-[#0F172A] focus:border-[#0b6cbf] focus:outline-none focus:ring-2 focus:ring-[#0b6cbf]/20"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="border-b border-red-100 bg-red-50 px-3 py-2 text-xs text-red-700"
              >
                {error}
              </div>
            )}

            <div className="max-h-64 overflow-y-auto">
              {candidates.length === 0 && (
                <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                  No eligible assignees in this branch.
                </div>
              )}

              {filteredCandidates.length === 0 && candidates.length > 0 && (
                <div className="px-4 py-6 text-center text-xs text-[#64748B]">
                  No matches for &quot;{search}&quot;.
                </div>
              )}

              {filteredCandidates.map((u) => {
                const isCurrent = existing?.assigned_to === u.id;
                return (
                  <button
                    key={u.id}
                    type="button"
                    role="option"
                    aria-selected={isCurrent}
                    onClick={() => !isCurrent && assign(u.id)}
                    disabled={saving || isCurrent}
                    className={
                      isCurrent
                        ? "flex w-full items-center justify-between gap-2 bg-[#EFF6FF] px-3 py-2 text-left text-sm text-[#0b6cbf]"
                        : "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-[#0F172A] transition-colors hover:bg-[#F8FAFC] disabled:cursor-not-allowed disabled:opacity-60"
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {u.name ?? u.email}
                      </span>
                      <span className="block truncate text-[11px] text-[#64748B]">
                        {u.email} · {ROLE_LABELS[u.role]}
                      </span>
                    </span>
                    {isCurrent && (
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[#0b6cbf]">
                        current
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {existing && (
              <div className="border-t border-[#F1F5F9] p-2">
                <button
                  type="button"
                  onClick={unassign}
                  disabled={saving}
                  className="w-full rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Unassign
                </button>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

function ReadonlyBadge({ label }: { label: string }) {
  const initial = label.charAt(0).toUpperCase();
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#0b6cbf]"
      title={label}
    >
      <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0b6cbf] text-[9px] font-bold text-white">
        {initial}
      </span>
      <span className="max-w-[100px] truncate">{label}</span>
    </span>
  );
}
