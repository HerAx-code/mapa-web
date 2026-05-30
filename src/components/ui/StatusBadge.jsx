import { APP_STATUS_CONFIG, DOC_STATUS_CONFIG, REPORT_STATUS_CONFIG, REQUEST_STATUS_CONFIG } from '../../utils/constants'

/**
 * Single source of truth for status display across the app. Replaces the
 * 10+ local STATUS_BADGE / STATUS_LABEL maps that drifted apart over time
 * (e.g., "Under Review" vs "Reviewing" for the same `reviewing` status).
 *
 * Usage:
 *   <StatusBadge status={app.status} kind="app" />
 *   <StatusBadge status={doc.status} kind="doc" />
 *   <StatusBadge status={report.status} kind="report" />
 *   <StatusBadge status={req.status} kind="request" />
 *
 * Props:
 *  - status: lowercase status string from Firestore
 *  - kind:   'app' (default) | 'doc' | 'report' | 'request'
 *  - className: extra Tailwind classes (e.g., size override)
 */

const CONFIGS = {
  app:     APP_STATUS_CONFIG,
  doc:     DOC_STATUS_CONFIG,
  report:  REPORT_STATUS_CONFIG,
  request: REQUEST_STATUS_CONFIG,
}

export default function StatusBadge({ status, kind = 'app', className = '' }) {
  const config = CONFIGS[kind] ?? {}
  const entry  = config[status]
  if (!entry) {
    return (
      <span className={`badge badge-gray text-xs ${className}`}>
        {status ?? '—'}
      </span>
    )
  }
  return (
    <span className={`badge text-xs ${entry.badge} ${className}`}>
      {entry.label}
    </span>
  )
}
