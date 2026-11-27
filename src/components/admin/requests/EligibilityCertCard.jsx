// Certificate of Eligibility card on the hospital's request detail
// (2026-11-16). Generate (frozen snapshot + yearly number) → print → the MSW
// signs, the head notes, the patient signs the conforme, the office stamps →
// upload the signed scan. A correction voids the certificate and a new number
// is issued; scans are never overwritten. See src/utils/eligibilityCert.js.
import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { MdVerifiedUser, MdPrint, MdUpload, MdOpenInNew, MdBlock, MdWarningAmber } from 'react-icons/md'
import toast from 'react-hot-toast'
import { db } from '../../../firebase'
import { ORG } from '../../../config/org'
import { logAudit } from '../../../utils/auditLog'
import { notify } from '../../../utils/notifications'
import { fetchHospitalBranding } from '../../../utils/hospitals'
import { useHospitalSettings } from '../../../hooks/useVerification'
import {
  coeNumber, counterId, certDocId, coeReadiness, buildCoeSnapshot, coeMissing, buildEligibilityCertificateHTML,
} from '../../../utils/eligibilityCert'
import { openSignedScan, sha256Hex } from '../../../utils/signedScan'
import SignedGLUploadModal from '../../SignedGLUploadModal'

const manilaYear = (d = new Date()) => new Date(d.getTime() + 8 * 3600000).getUTCFullYear()

export default function EligibilityCertCard({ request, user }) {
  const settings = useHospitalSettings()
  const [cert, setCert] = useState(null)
  const [patient, setPatient] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [voiding, setVoiding] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const pointer = request.eligibilityCert ?? null

  useEffect(() => {
    if (!pointer?.id) { setCert(null); return undefined }
    return onSnapshot(doc(db, 'eligibilityCertificates', pointer.id),
      snap => setCert(snap.exists() ? { id: snap.id, ...snap.data() } : null), () => setCert(null))
  }, [pointer?.id])

  useEffect(() => {
    if (!request.patientId) return
    getDoc(doc(db, 'users', request.patientId)).then(s => setPatient(s.exists() ? s.data() : {})).catch(() => setPatient({}))
  }, [request.patientId])

  const readiness = coeReadiness(request)
  const active = cert && cert.status !== 'voided' ? cert : null
  // What would print blank right now (for the warning before generating).
  const missing = useMemo(() => (patient ? coeMissing(buildCoeSnapshot({ request, patient, settings: settings ?? {}, controlNo: '' })) : []), [request, patient, settings])

  const generate = async () => {
    setBusy(true)
    try {
      const org = await fetchHospitalBranding(request.tenantId)
      const year = manilaYear()
      const counterRef = doc(db, 'eligibilityCounters', counterId(request.tenantId, year))
      const out = await runTransaction(db, async (tx) => {
        // Phase 3 PR 3.2 (gap N7): re-read the request inside the transaction,
        // so two clicks (or two staff) can't number two certificates for one case.
        const fresh = await tx.get(doc(db, 'requests', request.id))
        const live = fresh.data()?.eligibilityCert
        if (live?.id && live.status !== 'voided') throw new Error('COE_ACTIVE')
        const c = await tx.get(counterRef)
        const seq = c.exists() ? c.data().next : 1
        const controlNo = coeNumber(org.accessCodePrefix || ORG.accessCodePrefix, year, seq)
        const id = certDocId(request.id, controlNo)
        const snapshot = buildCoeSnapshot({ request, patient: patient ?? {}, org, settings: settings ?? {}, controlNo })
        if (c.exists()) tx.update(counterRef, { next: seq + 1 })
        else tx.set(counterRef, { tenantId: request.tenantId, year, next: 2 })
        tx.set(doc(db, 'eligibilityCertificates', id), {
          tenantId: request.tenantId, requestId: request.id, patientId: request.patientId,
          controlNo, snapshot, status: 'generated', signed: null, voided: null,
          generatedBy: user.name ?? '', generatedByUid: user.uid, generatedAt: serverTimestamp(),
        })
        tx.update(doc(db, 'requests', request.id), {
          eligibilityCert: { id, controlNo, status: 'generated', generatedAt: serverTimestamp() },
          updatedAt: serverTimestamp(),
        })
        return { id, controlNo, snapshot }
      })
      logAudit(user, {
        action: 'coe_generated', targetType: 'request', targetId: request.id, targetName: request.requestId ?? '',
        details: `Certificate of Eligibility ${out.controlNo} generated`, requestId: request.id, patientId: request.patientId,
      })
      printSnapshot(out.snapshot)
      toast.success(`Certificate ${out.controlNo} generated. Print, sign and stamp it, then upload the scan.`)
    } catch (e) {
      console.error('[CoE] generate failed', e)
      toast.error(e?.message === 'COE_ACTIVE'
        ? 'This case already has a certificate. Void it first to issue a new one.'
        : 'Could not generate the certificate. Please try again.')
    } finally { setBusy(false) }
  }

  const printSnapshot = (snapshot) => {
    const url = URL.createObjectURL(new Blob([buildEligibilityCertificateHTML(snapshot)], { type: 'text/html' }))
    const win = window.open(url, '_blank', 'width=900,height=1100')
    if (!win) { URL.revokeObjectURL(url); toast.error('Please allow pop-ups to print the certificate.'); return }
    // The certificate page carries no script of its own (CSP-safe): this window
    // (same origin — a blob URL) wires its Print button and opens the print
    // dialog once it has loaded.
    win.addEventListener('load', () => {
      try {
        win.document.getElementById('coe-print-btn')?.addEventListener('click', () => win.print())
        win.focus()
        win.print()
      } catch (e) { console.warn('[CoE] could not open the print dialog:', e) }
    }, { once: true })
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  const saveSigned = async ({ base64, contentType, fileName }) => {
    const sha256 = await sha256Hex(base64)
    // One batch: the certificate and the request's pointer move together (N7).
    const batch = writeBatch(db)
    batch.update(doc(db, 'eligibilityCertificates', active.id), {
      signed: { base64, contentType, fileName, sha256, uploadedBy: user.name ?? '', uploadedByUid: user.uid, uploadedAt: serverTimestamp() },
      status: 'signed', updatedAt: serverTimestamp(),
    })
    batch.update(doc(db, 'requests', request.id), {
      eligibilityCert: { ...pointer, status: 'signed', signedAt: serverTimestamp() }, updatedAt: serverTimestamp(),
    })
    await batch.commit()
    logAudit(user, {
      action: 'coe_signed_uploaded', targetType: 'request', targetId: request.id, targetName: request.requestId ?? '',
      details: `Signed Certificate of Eligibility ${active.controlNo} uploaded (sha256 ${sha256.slice(0, 12)}…)`,
      requestId: request.id, patientId: request.patientId,
    })
    notify(request.patientId, {
      type: 'certificate_ready', title: 'Your Certificate of Eligibility is available',
      body: `Your signed Certificate of Eligibility (${active.controlNo}) can be viewed on your Track Status page. Bring the original when an agency asks for it.`,
    }).catch(() => {})
    toast.success('Signed certificate uploaded.')
  }

  const voidCert = async () => {
    const reason = voidReason.trim()
    if (reason.length < 5) { toast.error('Give a reason (at least 5 characters).'); return }
    setBusy(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'eligibilityCertificates', active.id), {
        status: 'voided', voided: { reason, by: user.name ?? '', byUid: user.uid, at: serverTimestamp() }, updatedAt: serverTimestamp(),
      })
      batch.update(doc(db, 'requests', request.id), {
        eligibilityCert: { ...pointer, status: 'voided' }, updatedAt: serverTimestamp(),
      })
      await batch.commit()
      logAudit(user, {
        action: 'coe_voided', targetType: 'request', targetId: request.id, targetName: request.requestId ?? '',
        details: `Certificate of Eligibility ${active.controlNo} voided · reason: ${reason}`, requestId: request.id, patientId: request.patientId,
      })
      setVoiding(false); setVoidReason('')
      toast.success('Certificate voided. You can issue a new one.')
    } catch (e) {
      console.error('[CoE] void failed', e)
      toast.error('Could not void the certificate.')
    } finally { setBusy(false) }
  }

  const statusChip = !active ? null
    : active.status === 'signed'
      ? <span className="badge badge-green text-xs">Signed copy on file</span>
      : <span className="badge badge-amber text-xs">Awaiting signed copy</span>

  return (
    <div className="p-3 rounded-lg border border-gray-100 mb-2 space-y-2">
      <div className="flex items-center gap-2">
        <MdVerifiedUser size={16} className="text-gray-500 flex-shrink-0" />
        <p className="text-sm text-gray-700 flex-1 min-w-0 truncate">
          Certificate of Eligibility{active ? <span className="text-gray-500"> · {active.controlNo}</span> : ''}
        </p>
        {statusChip}
      </div>

      {!active && !readiness.ok && <p className="text-xs text-gray-500">{readiness.reason}</p>}

      {!active && readiness.ok && (
        <>
          {cert?.status === 'voided' && (
            <p className="text-xs text-gray-500">{cert.controlNo} was voided ({cert.voided?.reason}). Issue a new one when ready.</p>
          )}
          {missing.length > 0 && (
            <p className="text-xs text-amber-700 flex items-start gap-1">
              <MdWarningAmber size={14} className="flex-shrink-0 mt-0.5" />
              Not on record: {missing.join(', ')}. Blanks will print to fill in by hand.
            </p>
          )}
          <button className="btn-primary text-xs py-1.5" disabled={busy || patient == null} onClick={generate}>
            {busy ? 'Generating…' : cert?.status === 'voided' ? 'Issue a new certificate' : 'Generate & print'}
          </button>
        </>
      )}

      {active && (
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1" onClick={() => printSnapshot(active.snapshot)}>
            <MdPrint size={13} /> Print again
          </button>
          {active.status === 'generated' && (
            <button className="btn-primary text-xs py-1.5 inline-flex items-center gap-1" onClick={() => setShowUpload(true)}>
              <MdUpload size={13} /> Upload signed copy
            </button>
          )}
          {active.status === 'signed' && (
            <button className="btn-secondary text-xs py-1.5 inline-flex items-center gap-1" onClick={() => openSignedScan(active.signed)}>
              <MdOpenInNew size={13} /> View signed copy
            </button>
          )}
          <button className="text-xs text-gray-500 hover:text-red-600 inline-flex items-center gap-1" onClick={() => setVoiding(v => !v)}>
            <MdBlock size={13} /> Void
          </button>
        </div>
      )}

      {active?.status === 'generated' && (
        <p className="text-xs text-gray-500">Print it, have the social worker sign, the department head sign as issuer and the patient sign the conforme, stamp it, then upload the scan.</p>
      )}

      {active && voiding && (
        <div className="space-y-1.5">
          <input className="input text-sm" maxLength={200} placeholder="Reason for voiding (e.g. wrong diagnosis printed)"
            value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <div className="flex gap-2 justify-end">
            <button className="btn-secondary text-xs py-1.5" onClick={() => { setVoiding(false); setVoidReason('') }}>Cancel</button>
            <button className="btn-danger text-xs py-1.5" disabled={busy} onClick={voidCert}>Void certificate</button>
          </div>
        </div>
      )}

      {showUpload && active && (
        <SignedGLUploadModal
          app={{ patientName: request.patientName, appId: active.controlNo }}
          existing={null}
          docLabel="Certificate of Eligibility" short="Certificate"
          subtitle={`${request.patientName ?? ''} · ${active.controlNo}`}
          onSave={saveSigned}
          onClose={() => setShowUpload(false)}
        />
      )}
    </div>
  )
}
