import { ChevronRight, Clock3 } from "lucide-react";
import type { Scan } from "../../../shared/types";
import { Action, Blank, SectionHeader } from "../ui";

export function ScanHistory({
  history,
  currentId,
  onOpen,
  onNew,
}: {
  history: Scan[];
  currentId?: string;
  onOpen: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <>
      <SectionHeader
        title="Scan History"
        question="Earlier investigations stored on this server. Open one to return to its workspace."
      />
      {history.length ? (
        <section className="history-list mt-0 overflow-hidden rounded-[10px] border border-border">
          {history.map((item) => (
            <button key={item.id} className="history-row" onClick={() => onOpen(item.id)}>
              <Clock3 size={18} />
              <span>
                <strong>{item.name}</strong>
                <small>
                  {item.ref} · {new Date(item.createdAt).toLocaleString()}
                  {item.id === currentId ? " · open now" : ""}
                </small>
              </span>
              <span className={`status-badge ${item.mode === "demo" ? "demo" : ""}`}>
                {item.status === "mapped" ? "Awaiting selection" : item.status}
              </span>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
      ) : (
        <Blank title="No scans yet" action={<Action text="New Scan" onClick={onNew} />} />
      )}
    </>
  );
}
