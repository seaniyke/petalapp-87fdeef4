/**
 * CloudUsersView — lists auth users in the project's managed backend.
 */
import { useEffect, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listProjectUsers,
  type CloudAuthUser,
} from "@/server/cloud-users.functions";
import { CloudEmptyState } from "./CloudEmptyState";

export function CloudUsersView({ projectId }: { projectId: string }) {
  const fn = useServerFn(listProjectUsers);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [users, setUsers] = useState<CloudAuthUser[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn({ data: { projectId, page: 1, perPage: 20 } })
      .then((r) => {
        if (cancelled) return;
        setAvailable(r.available);
        setUsers(r.users);
      })
      .catch(() => !cancelled && setAvailable(false))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [fn, projectId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-10 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!available) {
    return (
      <div className="p-4">
        <CloudEmptyState
          title="No backend yet"
          description="Enable Petal Cloud to see signups and configure how people sign in."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Users className="h-4 w-4" />
        <span>{users.length} signups</span>
      </div>

      {users.length === 0 ? (
        <CloudEmptyState
          title="No users yet"
          description="Once people sign up, they'll appear here."
        />
      ) : (
        <ul className="space-y-2">
          {users.map((u) => (
            <li
              key={u.id}
              className="rounded-xl bg-muted/40 px-4 py-3 text-sm"
            >
              <div className="font-medium">{u.email ?? "(no email)"}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Joined {new Date(u.createdAt).toLocaleDateString()} ·{" "}
                {u.provider ?? "email"}
                {u.lastSignInAt &&
                  ` · last seen ${new Date(u.lastSignInAt).toLocaleDateString()}`}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
