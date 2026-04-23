import type { ImpactDecision, PendingImpactUpdate } from "../../shared/types";

interface DependencyImpactModalProps {
  pendingImpact: PendingImpactUpdate;
  onDecisionChange: (queryId: string, decision: ImpactDecision) => void;
  onApply: () => void;
  onDismiss: () => void;
}

export function DependencyImpactModal({
  pendingImpact,
  onDecisionChange,
  onApply,
  onDismiss
}: DependencyImpactModalProps) {
  return (
    <div className="modal-backdrop">
      <section className="impact-modal">
        <h3>Dependency Impact</h3>
        <p className="hint-line">
          Editing <strong>{pendingImpact.editedQueryName}</strong> created a new
          version. Choose how dependents should behave.
        </p>
        <ul className="list-block">
          {pendingImpact.items.map((item) => (
            <li key={item.queryId} className="list-row">
              <div>
                <div className="list-title">{item.queryName}</div>
                <div className="list-subtitle">
                  Dependency depth: {item.depth}
                </div>
              </div>
              <select
                value={item.decision}
                onChange={(event) =>
                  onDecisionChange(
                    item.queryId,
                    event.target.value as ImpactDecision
                  )
                }
              >
                <option value="keep_pinned">Keep pinned</option>
                <option value="adopt_new">Adopt new upstream</option>
                <option value="fork_dependent">Fork dependent</option>
              </select>
            </li>
          ))}
        </ul>
        <div className="inline-row">
          <button type="button" className="btn btn-primary" onClick={onApply}>
            Apply Decisions
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDismiss}>
            Close (Keep Pinned)
          </button>
        </div>
      </section>
    </div>
  );
}
