interface ConfirmActionModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmActionModal({
  open,
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm
}: ConfirmActionModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <div className="impact-modal confirm-modal">
        <h3>{title}</h3>
        <div className="hint-line">{message}</div>
        <div className="inline-row">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-ghost danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

