import { AlertTriangle, X } from 'lucide-react'

interface Props {
  message: string
  onDismiss?: () => void
}

export function ErrorBanner({ message, onDismiss }: Props) {
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={16} strokeWidth={2} className="error-banner-icon" />
      <span className="error-banner-message">{message}</span>
      {onDismiss && (
        <button className="error-banner-dismiss" onClick={onDismiss} aria-label="Dismiss">
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}
