"use client";

/**
 * Orchestrator: owns the create/edit modal state, hands the rows to the
 * table, and triggers `router.refresh()` after mutations so the server
 * component re-fetches the latest list.
 *
 * Threads the ACTOR's full SessionUser down to the modals so the role
 * picker can filter options correctly under the Phase 2H hierarchy
 * (admins see all roles, managers see only sales-tier).
 */
import { useState } from "react";
import type { SessionUser } from "@/src/types/auth";
import { canManageUsers } from "@/src/lib/permissions";
import UsersTable from "./UsersTable";
import CreateUserModal from "./CreateUserModal";
import EditUserModal from "./EditUserModal";

interface Props {
  /** Users the actor is allowed to manage (already filtered server-side). */
  users: SessionUser[];
  /** The actor running the page — for both ID-based self-checks and role-based
   * picker filtering. */
  actor: SessionUser;
}

export default function UsersClient({ users, actor }: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SessionUser | null>(null);

  // Phase 2W: SSE has VIEW-only user management. The action button (and
  // Create modal mount) only render when the actor can actually create
  // users — server still re-checks every POST.
  const canCreate = canManageUsers(actor);

  const subtitle =
    actor.rank >= 80
      ? `${users.length} total · admin scope (all users)`
      : canCreate
        ? `${users.length} total · scoped to roles you can manage`
        : `${users.length} total · view-only`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A]">Users</h1>
          <p className="mt-1 text-xs text-[#64748B]">{subtitle}</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="rounded-xl bg-[#0b6cbf] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#095699]"
          >
            New user
          </button>
        )}
      </div>

      <UsersTable
        users={users}
        currentUserId={actor.id}
        actorRank={actor.rank}
        onEdit={setEditTarget}
      />

      {canCreate && (
        <CreateUserModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          actorRank={actor.rank}
          users={users}
          actor={actor}
        />
      )}

      {editTarget && (
        <EditUserModal
          open={editTarget !== null}
          onClose={() => setEditTarget(null)}
          user={editTarget}
          currentUserId={actor.id}
          actorRank={actor.rank}
          users={users}
        />
      )}
    </div>
  );
}
