import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { doc, getDoc, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { notify } from '../../utils/notifications'
import {
  MdArrowBack, MdPrint, MdUpload, MdInfo, MdKeyboard,
  MdCheckCircle, MdWarning,
} from 'react-icons/md'
import toast from 'react-hot-toast'
import Layout from '../../components/Layout'
import GuaranteeLetter from '../../components/GuaranteeLetter'
import SignedGLUploadModal from '../../components/SignedGLUploadModal'

// This page renders the Guarantee Letter natively (browser layout engine)
// so the on-screen view and the printed/saved-as-PDF output are pixel-identical.

export default function GLViewer() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const { user }     = useAuth()

  const [app, setApp]                 = useState(null)
  const [patient, setPatient]         = useState({})
  const [agency, setAgency]           = useState(null)
  const [signedScan, setSignedScan]   = useState(null)
  const [loading, setLoading]         = useState(true)
  const [showUpload, setShowUpload]   = useState(false)
  const [markingIssued, setMarkingIssued] = useState(false)
  const [showConfirmIssued, setShowConfirmIssued] = useState(false)

  // R28: only the FIRST snapshot's missing state counts as "not found";
  // subsequent missing states (Firestore offline replay, a transient
  // delete race, network blip) shouldn't yank the agency out of an open
  // GL viewer mid-session. firstLoad ref flips after the first snapshot
  // arrives so later misses get logged but don't navigate.
  const firstLoad = useRef(true)
  useEffect(() => {
    if (!id) return
    firstLoad.current = true
    const unsub = onSnapshot(doc(db, 'applications', id), snap => {
      if (!snap.exists()) {
        if (firstLoad.current) {
          toast.error('Application not found.')
          navigate('/agency/inbox')
        } else {
          console.warn('[GLViewer] application doc went missing mid-session; keeping last state on screen')
        }
        return
      }
      firstLoad.current = false
      setApp({ id: snap.id, ...snap.data() })
      setLoading(false)
    }, () => { setLoading(false); toast.error('Failed to load application.') })
    return unsub
  }, [id, navigate])

  // Load patient + agency (one-shot)
  useEffect(() => {
    if (!app?.patientId) return
    getDoc(doc(db, 'users', app.patientId))
      .then(snap => { if (snap.exists()) setPatient(snap.data()) })
  }, [app?.patientId])

  useEffect(() => {
    if (!user?.agencyId) return
    getDoc(doc(db, 'agencies', user.agencyId))
      .then(snap => { if (snap.exists()) setAgency({ id: snap.id, ...snap.data() }) })
  }, [user?.agencyId])

  // Subscribe to signed scan (so the Upload action UI knows current state)
  useEffect(() => {
    if (!app?.id) return
    const unsub = onSnapshot(doc(db, 'certificates', app.id), snap => {
      setSignedScan(snap.exists() ? snap.data() : null)
    }, (err) => console.error('[GLViewer] certificate snapshot error:', err))
    return unsub
  }, [app?.id])

  const signatory = app ? {
    name:  app.conductedBy || agency?.defaultSignatory || app.approvedBy || user?.name || 'Authorized Personnel',
    title: app.conductedBy ? 'Medical Social Worker' : 'Agency Coordinator',
  } : null


  // Note: button onClick handlers are inline as `() => window.print()` to
  // keep the call as tight to the user gesture as the browser can verify.
  // Any indirection (toast first, setTimeout, helper functions) can cause
  // the print dialog to be silently blocked.

  // Mark the GL as Issued — flips status from approved → certificate and
  // notifies the patient. Coordinator-only. The confirmation goes through
  // an in-app modal (not window.confirm) so it matches the rest of the
  // app's design language.
  //
  // Note: previously also wrote a stages[] array map here. The stages
  // field on applications is deprecated -- the Timeline view derives
  // from `status` directly (see admin/Requests sliceStages cleanup +
  // §6.2 thesis doc). Other writers were dropped earlier; this was the
  // last lingering one.
  const performMarkIssued = async () => {
    if (!app || markingIssued) return
    setMarkingIssued(true)
    try {
      await updateDoc(doc(db, 'applications', app.id), {
        status:    'certificate',
        updatedAt: serverTimestamp(),
      })
      await notify(app.patientId, {
        type:  'certificate_ready',
        title: 'Your Guarantee Letter has been issued',
        body:  `Your Guarantee Letter for ₱${Number(app.approvedAmount ?? 0).toLocaleString()} from ${app.agencyName} has been issued. ${app.agencyName} is preparing the signed copy — you'll be notified when it's ready to download.`,
      })
      toast.success('Marked as Issued. Patient has been notified.')
      setShowConfirmIssued(false)
    } catch (err) {
      console.error(err)
      toast.error('Failed to mark as Issued. Please try again.')
    } finally {
      setMarkingIssued(false)
    }
  }

  // Listen for Ctrl/Cmd+P as a guaranteed fallback so the page is usable
  // even if button clicks somehow fail.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'p' || e.key === 'P')) {
        // Let the browser handle it naturally — don't preventDefault.
        toast('Opening print dialog…', { duration: 1500 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading || !app) return (
    <Layout breadcrumb="Guarantee Letter">
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-sm text-gray-400 animate-pulse">Loading Guarantee Letter…</div>
      </div>
    </Layout>
  )

  const canUpload = (user?.role === 'agency' || user?.role === 'agency_admin') && (app.status === 'approved' || app.status === 'certificate')

  return (
    <Layout breadcrumb="Guarantee Letter">
    <div className="bg-gray-100 min-h-full">

      {/* ── Thin nav strip (back + identity; hidden during print) ── */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 print:hidden">
        <div className="max-w-[1400px] mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <Link to={`/agency/applications/${app.id}`}
            className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-600 font-medium">
            <MdArrowBack size={16} /> Back to application
          </Link>
          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="font-mono">{app.appId}</span>
            <span className="text-gray-300">·</span>
            <span>{app.patientName}</span>
          </div>
        </div>
      </div>

      {/* ── Document workspace: the letter stays paper-shaped (A4/800px) while
          status, case facts, and every action live in a sticky rail beside it,
          so the horizontal space is used without stretching a legal document.
          On print the rail drops out and only the paper remains. ── */}
      <div className="max-w-[1400px] mx-auto px-4 py-6 print:p-0 print:max-w-none">
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start print:block">

          {/* Paper */}
          <div className="order-2 lg:order-1 min-w-0 print:order-none">
            <div className="max-w-[800px] mx-auto bg-white shadow-md print:shadow-none">
              <GuaranteeLetter
                app={app}
                patient={patient}
                signatory={signatory}
              />
            </div>
          </div>

          {/* Action rail */}
          <aside className="order-1 lg:order-2 space-y-4 lg:sticky lg:top-[68px] print:hidden">

            {/* Status */}
            {app.status === 'approved' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1.5">
                  <MdWarning size={16} className="flex-shrink-0" /> Not issued yet
                </p>
                <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                  Print (or Save as PDF) the letter, then mark it issued to advance the application and notify the patient.
                </p>
              </div>
            )}
            {app.status === 'certificate' && (
              <div className="bg-green-50 border border-green-100 rounded-xl p-4">
                <p className="text-sm font-semibold text-green-700 flex items-center gap-1.5">
                  <MdCheckCircle size={16} className="flex-shrink-0" /> Guarantee Letter issued
                </p>
                <p className="text-xs text-green-700/90 mt-1 leading-relaxed">
                  {signedScan
                    ? 'Signed scan uploaded — the patient can download it from Track Status.'
                    : 'Upload the wet-signed scan so the patient can download the signed copy.'}
                </p>
              </div>
            )}
            {!['approved', 'certificate'].includes(app.status) && (
              <div className="bg-gray-100 border border-gray-200 rounded-xl p-4">
                <p className="text-sm font-medium text-gray-600 flex items-center gap-1.5">
                  <MdInfo size={16} className="flex-shrink-0" /> Draft — not yet approved
                </p>
                <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                  The letter below is for review only until the application is approved.
                </p>
              </div>
            )}

            {/* Case facts */}
            <div className="card p-4">
              <p className="eyebrow mb-2">Guarantee Letter</p>
              <dl className="space-y-2 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500">Amount approved</dt>
                  <dd className="tabular-nums font-semibold text-brand-700">₱{Number(app.approvedAmount ?? 0).toLocaleString()}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500 flex-shrink-0">Patient</dt>
                  <dd className="text-gray-800 text-right truncate">{app.patientName}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500 flex-shrink-0">Agency</dt>
                  <dd className="text-gray-800 text-right truncate">{app.agencyName}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-gray-500 flex-shrink-0">Application</dt>
                  <dd className="font-mono text-xs text-gray-500 text-right truncate">{app.appId}</dd>
                </div>
              </dl>
            </div>

            {/* Actions */}
            <div className="card p-4 space-y-2">
              {/* One button — both physical-print and PDF-save go through the
                  browser print dialog. Kept as an inline window.print() tight
                  to the gesture; any indirection can get the dialog blocked. */}
              <button type="button"
                onClick={() => window.print()}
                className="btn-primary text-sm w-full flex items-center justify-center gap-1.5"
                title="Opens the browser print dialog — pick your printer, or pick 'Save as PDF' as the destination to get a PDF file.">
                <MdPrint size={14} /> Print / Save as PDF
              </button>
              {app.status === 'approved' && (
                <button type="button"
                  className="text-sm w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  disabled={markingIssued}
                  onClick={() => setShowConfirmIssued(true)}>
                  <MdCheckCircle size={14} /> {markingIssued ? 'Marking…' : 'Mark as Issued'}
                </button>
              )}
              {canUpload && (
                <button type="button"
                  onClick={() => setShowUpload(true)}
                  className="text-sm w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-green-500 text-white hover:bg-green-600 transition-colors">
                  <MdUpload size={14} /> {signedScan ? 'Replace Signed Scan' : 'Upload Signed Scan'}
                </button>
              )}
            </div>

            {/* Print help */}
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-xs text-blue-700 leading-relaxed">
                <strong>Print / Save as PDF</strong> opens the browser dialog. Pick your printer to wet-sign, or choose <em>"Save as PDF"</em> for a true vector PDF identical to what you see.
              </p>
              <span className="mt-2 inline-flex items-center gap-1 rounded bg-white/60 px-2 py-1 text-xs text-blue-600">
                <MdKeyboard size={12} /> Or press Ctrl/Cmd+P
              </span>
            </div>
          </aside>

        </div>
      </div>

      {/* ── Upload modal ── */}
      {showUpload && (
        <SignedGLUploadModal app={app} existing={signedScan} onClose={() => setShowUpload(false)} />
      )}

      {/* ── Confirm Mark-as-Issued modal ── */}
      {showConfirmIssued && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 print:hidden"
          onClick={e => e.target === e.currentTarget && !markingIssued && setShowConfirmIssued(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
              <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <MdCheckCircle size={18} className="text-amber-500" />
              </div>
              <h2 className="text-base font-semibold text-gray-900">Mark Guarantee Letter as Issued?</h2>
            </div>
            <div className="px-5 py-4 space-y-2">
              <p className="text-sm text-gray-600 leading-relaxed">
                This sets the application status to <strong>"Guarantee Letter Issued"</strong> and notifies the patient.
              </p>
              <p className="text-xs text-gray-500 leading-relaxed">
                Only confirm if the GL was successfully printed (and ideally also wet-signed). The patient will then expect you to upload the wet-signed scan.
              </p>
            </div>
            <div className="px-5 py-3 border-t border-gray-50 bg-gray-50/60 flex gap-2 justify-end">
              <button type="button" className="btn-secondary text-sm"
                disabled={markingIssued}
                onClick={() => setShowConfirmIssued(false)}>
                Cancel
              </button>
              <button type="button"
                className="text-sm flex items-center gap-1.5 px-3 py-2 rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-60 disabled:cursor-not-allowed"
                disabled={markingIssued}
                onClick={performMarkIssued}>
                <MdCheckCircle size={14} /> {markingIssued ? 'Marking…' : 'Mark as Issued'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Global print styles ── */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          body { background: #fff !important; }
        }
      `}</style>
    </div>
    </Layout>
  )
}
