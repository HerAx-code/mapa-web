import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { MdMarkEmailRead, MdEmail, MdLocalHospital } from 'react-icons/md'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { tsToDate } from '../../utils/dates'
import { useOnboardingRequests } from '../../hooks/useOnboardingRequests'
import { useHospitals } from '../../hooks/useHospitals'

// Loose name match for the "already on the network" hint: case, spacing and
// punctuation don't matter ("Davao Regional Med. Center" ~ "davao regional med center").
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Onboarding requests — hospitals that asked to join from the public
// "For hospitals" page (MAPA Platform Redesign canvas). The network admin
// contacts them, then sets the hospital up from here (pre-fills Add hospital).

const STATUSES = [
  { key: 'new',       label: 'New' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'onboarded', label: 'Onboarded' },
  { key: 'declined',  label: 'Declined' },
]
const BADGE = {
  new:       'bg-brand-50 text-brand-700',
  contacted: 'bg-blue-50 text-blue-700',
  onboarded: 'bg-green-50 text-green-800',
  declined:  'bg-gray-100 text-gray-600',
}

export default function OnboardingRequests() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { requests, loading } = useOnboardingRequests(true)
  const { hospitals } = useHospitals()
  const existingMatch = (r) => {
    const n = normName(r.hospitalName)
    return n ? hospitals.find((h) => normName(h.facilityName) === n || (h.shortName && normName(h.shortName) === n)) : null
  }
  const [tab, setTab] = useState('new')
  const [busyId, setBusyId] = useState(null)

  const shown = requests.filter((r) => (r.status || 'new') === tab)

  const setStatus = async (r, status) => {
    setBusyId(r.id)
    try {
      await updateDoc(doc(db, 'onboardingRequests', r.id), { status, statusUpdatedAt: serverTimestamp() })
      logAudit(user, { action: 'onboarding_request_updated', targetType: 'onboardingRequest', targetId: r.id, targetName: r.hospitalName, details: `Status: ${status}` })
      toast.success(`Marked ${status}.`)
    } catch (err) {
      console.error(err)
      toast.error('Could not update the request.')
    } finally {
      setBusyId(null)
    }
  }

  // Hand the details to Add hospital on the console; it links the request
  // back (status onboarded + hospitalId) once the hospital is created.
  const setUp = (r) => navigate('/platform/hospitals', {
    state: { prefill: { facilityName: r.hospitalName, region: r.region || '', contactEmail: r.email || '' }, fromRequest: r.id },
  })

  return (
    <Layout breadcrumb="Onboarding requests">
      <div className="w-full p-4 sm:p-6 max-w-[1100px] mx-auto">
        <div className="mb-5">
          <p className="eyebrow">Network</p>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-brand-900 mt-1">Onboarding requests</h1>
          <p className="text-sm text-gray-500 mt-1">Hospitals that asked to join from the public “For hospitals” page.</p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4" role="tablist" aria-label="Request status">
          {STATUSES.map((s) => {
            const n = requests.filter((r) => (r.status || 'new') === s.key).length
            const on = tab === s.key
            return (
              <button key={s.key} role="tab" aria-selected={on} onClick={() => setTab(s.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 min-h-[36px] text-[13px] font-semibold transition-colors ${on ? 'bg-brand-500 border-brand-500 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-200'}`}>
                {s.label} <span className={`tabular-nums ${on ? 'text-white/85' : 'text-gray-400'}`}>{n}</span>
              </button>
            )
          })}
        </div>

        {loading ? (
          <div className="card p-8 flex justify-center">
            <div className="w-8 h-8 border-2 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          </div>
        ) : shown.length === 0 ? (
          <div className="card p-8 text-center">
            <MdMarkEmailRead size={28} className="mx-auto text-gray-300" />
            <p className="text-sm font-medium text-gray-700 mt-2">No {STATUSES.find((s) => s.key === tab)?.label.toLowerCase()} requests</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {shown.map((r) => {
              const at = tsToDate(r.createdAt)
              const status = r.status || 'new'
              return (
                <li key={r.id} className="card p-4 sm:p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-gray-900">{r.hospitalName}</p>
                        <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-bold ${BADGE[status] ?? BADGE.new}`}>
                          {STATUSES.find((s) => s.key === status)?.label ?? status}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {[r.hospitalType, r.region, at && `sent ${at.toLocaleDateString('en-PH', { dateStyle: 'medium' })}`].filter(Boolean).join(' · ')}
                      </p>
                      <p className="text-sm text-gray-700 mt-2">
                        {r.contactName} · <a className="text-brand-600 hover:text-brand-700 font-medium" href={`mailto:${r.email}?subject=${encodeURIComponent('MAPA onboarding — ' + r.hospitalName)}`}>{r.email}</a>
                      </p>
                      {r.message && <p className="text-sm text-gray-600 mt-2 whitespace-pre-line">{r.message}</p>}
                      {r.hospitalId && <p className="text-xs text-green-700 mt-2">Set up as <span className="font-mono">{r.hospitalId}</span></p>}
                      {!r.hospitalId && existingMatch(r) && (
                        <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5 mt-2 inline-block">
                          Possible duplicate — already on the network as <span className="font-semibold">{existingMatch(r).facilityName || existingMatch(r).id}</span>.
                        </p>
                      )}
                    </div>
                    <div className="flex sm:flex-col gap-2 flex-shrink-0">
                      {status !== 'onboarded' && (
                        <button className="btn-primary text-xs min-h-[36px] justify-center inline-flex items-center gap-1" onClick={() => setUp(r)}>
                          <MdLocalHospital size={14} /> Set up hospital
                        </button>
                      )}
                      {status === 'new' && (
                        <button className="btn-secondary text-xs min-h-[36px] justify-center inline-flex items-center gap-1" disabled={busyId === r.id} onClick={() => setStatus(r, 'contacted')}>
                          <MdEmail size={14} /> Mark contacted
                        </button>
                      )}
                      {status !== 'declined' && status !== 'onboarded' && (
                        <button className="btn-secondary text-xs min-h-[36px] justify-center" disabled={busyId === r.id} onClick={() => setStatus(r, 'declined')}>
                          Decline
                        </button>
                      )}
                      {status === 'declined' && (
                        <button className="btn-secondary text-xs min-h-[36px] justify-center" disabled={busyId === r.id} onClick={() => setStatus(r, 'new')}>
                          Reopen
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Layout>
  )
}
