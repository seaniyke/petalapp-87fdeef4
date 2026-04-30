/**
 * CloudStorageView — lists storage buckets in the project's managed backend.
 */
import { useEffect, useState } from "react";
import { HardDrive, Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import {
  listProjectBuckets,
  type CloudBucket,
} from "@/server/cloud-storage.functions";
import { CloudEmptyState } from "./CloudEmptyState";

export function CloudStorageView({ projectId }: { projectId: string }) {
  const fn = useServerFn(listProjectBuckets);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);
  const [buckets, setBuckets] = useState<CloudBucket[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn({ data: { projectId } })
      .then((r) => {
        if (cancelled) return;
        setAvailable(r.available);
        setBuckets(r.buckets);
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
          description="Enable Petal Cloud to use file storage for images, documents and uploads."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HardDrive className="h-4 w-4" />
        <span>{buckets.length} buckets</span>
      </div>

      {buckets.length === 0 ? (
        <CloudEmptyState
          title="No buckets yet"
          description="When your app uploads files, the bucket will show up here."
        />
      ) : (
        <ul className="space-y-2">
          {buckets.map((b) => (
            <li
              key={b.id}
              className="flex items-center justify-between rounded-xl bg-muted/40 px-4 py-3 text-sm"
            >
              <div>
                <div className="font-medium">{b.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Created {new Date(b.createdAt).toLocaleDateString()}
                </div>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] ${
                  b.isPublic
                    ? "bg-primary/10 text-primary"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {b.isPublic ? "Public" : "Private"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
