import './ConfirmationModal.css';

const ConfirmationModal = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  children,
  confirmText = "Potwierdź",
  cancelText = "Anuluj",
  confirmVariant = "delete" // 'delete', 'success', 'primary'
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <div className="confirmation-content">
          {children}
        </div>
        <div className="form-actions">
          <button className="btn btn-cancel" onClick={onClose}>{cancelText}</button>
          <button className={`btn btn-${confirmVariant}`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;
