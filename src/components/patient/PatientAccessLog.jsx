import { useEffect, useState } from 'react'
import { collection, query, where, orderBy, onSnapshot, limit } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { useTranslation } from 'react-i18next'
import {
  MdSecurity, MdVisibility, MdEdit, MdCheckCircle, MdCancel,
  MdSchedule, MdHistory, MdShield,
} from 'react-icons/md'

/**
 * PatientAccessLog — R37: citizen-visible audit trail.
 *
 * Implements the patient-facing branch of RA 10173 §16(c) (right to
 * access) and aligns with Estonia's X-Road "every access by a public
 * official is visible to the citizen" model. Patients see every
 * agency / CRMC interaction with their record in plain language --
 * who, what, when -- with no system jargon.
 *
 * Reads auditLog entries where patientId == current user's uid, scoped
 * by the firestore.rule clause that allows `isAuth() &&
 * resource.data.patientId == uid()`.
 */

const ACTION_LABELS = {
  app_approved:       { label: 'approved a funding slice on your case',  icon: MdCheckCircle, tone: 'green'  },
  app_rejected:       { label: 'rejected a funding slice on your case',  icon: MdCancel,      tone: 'red'    },
  app_requested_info: { label: 'asked for more information',             icon: MdEdit,        tone: 'amber'  },
  slice_advanced:     { label: 'moved your case forward',                icon: MdSchedule,    tone: 'brand'  },
  patient_proceeded:  { label: 'you confirmed an endorsement',           icon: MdCheckCircle, tone: 'brand'  },
  endorse_request:    { label: 'endorsed your case to a partner agency', icon: MdSchedule,    tone: 'brand'  },
  request_assessment: { label: 'started the social-worker assessment',   icon: MdEdit,        tone: 'brand'  },
  doc_verified:       { label: 'verified one of your documents',         icon: MdCheckCircle, tone: 'green'  },
  doc_rejected:       { label: 'rejected one of your documents',         icon: MdCancel,      tone: 'red'    },
  gl_issued:          { label: 'issued your Guarantee Letter',           icon: MdShield,      tone: 'green'  },
  gl_redeemed:        { label: 'marked your Guarantee Letter redeemed',  icon: MdCheckCircle, tone: 'green'  },
  view_record:        { label: 'opened your record',                     icon: MdVisibility,  tone: 'gray'   },
}

const TONE_CLASSES = {
  green: { bg: 'bg-green-50',  text: 'text-green-700',  ring: 'ring-green-100'  },
  red:   { bg: 'bg-red-50',    text: 'text-red-600',    ring: 'ring-red-100'    },
  amber: { bg: 'bg-amber-50',  text: 'text-amber-700',  ring: 'ring-amber-100'  },
  brand: { bg: 'bg-brand-50',  text: 'text-brand-600',  ring: 'ring-brand-100'  },
  gray:  { bg: 'bg-gray-50',   text: 'text-gray-500',   ring: 'ring-gray-100'   },
}

const formatWhen = (ts) => {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function PatientAccessLog() {
  const { user } = useAuth()
  const { t }    = useTranslation()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState(null)

  useEffect(() => {
    if (!user?.uid) return
    setLoading(true)
    const q = query(
      collection(db, 'auditLog'),
      where('patientId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(100),
    )
    const unsub = onSnapshot(
      q,
      snap => {
        setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
        setLoading(false)
        setError(null)
      },
      err => {
        console.error('[PatientAccessLog] snapshot error:', err)
        setError(err)
        setLoading(false)
      },
    )
    return () => unsub()
  }, [user?.uid])

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <MdSecurity className="text-brand-500" size={18} />
        <h2 className="text-sm font-semibold text-gray-900">{t('shell.accessLog.title')}</h2>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        {t('shell.accessLog.componentDescription')}
      </p>

      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => (
            <div key={i} className="h-12 bg-gray-50 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : error ? (
        <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-lg">
          {t('shell.accessLog.unavailable')}
        </p>
      ) : entries.length === 0 ? (
        <div className="text-center py-6">
          <MdHistory size={28} className="text-gray-300 mx-auto mb-1" />
          <p className="text-xs text-gray-400">{t('shell.accessLog.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-0">
          {entries.map((e, idx) => {
            const meta = ACTION_LABELS[e.action] ?? {
              label: `performed an action (${e.action})`,
              icon:  MdHistory,
              tone:  'gray',
            }
            const Icon = meta.icon
            const tone = TONE_CLASSES[meta.tone]
            const isLast = idx === entries.length - 1
            return (
              <li key={e.id} className="relative flex gap-3 pb-3">
                {/* connector line behind icons */}
                {!isLast && <div className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-100" />}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full ring-4 ${tone.ring} ${tone.bg} flex items-center justify-center`}>
                  <Icon className={tone.text} size={14} />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <p className="text-xs text-gray-800 leading-snug">
                    <span className="font-medium">{e.actorName || 'A staff member'}</span>
                    {' '}{meta.label}.
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {formatWhen(e.createdAt)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
