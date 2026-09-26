import { useEffect, useState } from "react";
import { readPendingWrites } from "@/lib/pending-writes";
import { retryPendingWrites } from "@/lib/api";

export default function PendingSaves() {
  const [rows, setRows] = useState(readPendingWrites);
  useEffect(() => {
    const refresh = () => setRows(readPendingWrites());
    window.addEventListener("pending-writes-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener("pending-writes-changed", refresh); window.removeEventListener("storage", refresh); };
  }, []);
  if (!rows.length) return null;
  return <div role="status" className="border border-amber-500/40 bg-background p-3 text-sm mb-4">
    {rows.find(row => row.error)?.error || `${rows.length} change${rows.length === 1 ? "" : "s"} saved on this device, awaiting server confirmation.`}
    <button className="underline ml-3" onClick={() => void retryPendingWrites()}>Retry save</button>
  </div>;
}
