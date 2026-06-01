import Layout from '../../components/Layout'
import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, query, where, onSnapshot, doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { MdCardMembership, MdPrint, MdSearch, MdCheckCircle, MdUpload, MdClose } from 'react-icons/md'
import toast from 'react-hot-toast'
import { notify } from '../../utils/notifications'
import { tsToDate } from '../../utils/dates'
import SignedGLUploadModal from '../../components/SignedGLUploadModal'

// ── Certificate HTML builder ──────────────────────────────────────────────

export const buildCertificateHTML = ({ app, patient, approvalDate, issueDate, signatory, preview = false }) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Guarantee Letter for Medical Assistance – ${app.appId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      background: #fff;
      color: #1a1a1a;
      padding: 40px 60px;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 24px;
      margin-bottom: 12px;
    }
    .seal {
      width: 80px; height: 80px; flex-shrink: 0;
    }
    .header-text { text-align: center; }
    .republic   { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #444; }
    .agency     { font-size: 18px; font-weight: bold; color: #1a3a5c; line-height: 1.2; }
    .sub        { font-size: 11px; color: #555; margin-top: 2px; }
    .divider    { border: none; border-top: 2px solid #1a3a5c; margin: 14px 0 10px; }
    .divider-thin { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
    .cert-title {
      text-align: center;
      font-size: 20px;
      font-weight: bold;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: #1a3a5c;
      margin: 10px 0 4px;
    }
    .cert-sub {
      text-align: center;
      font-size: 11px;
      color: #666;
      letter-spacing: 1px;
      text-transform: uppercase;
      margin-bottom: 20px;
    }
    .certify-text {
      text-align: center;
      font-size: 12px;
      color: #444;
      margin-bottom: 18px;
    }
    .patient-name {
      text-align: center;
      font-size: 26px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 2px;
      color: #1a1a1a;
      border-bottom: 2px solid #1a1a1a;
      display: inline-block;
      padding-bottom: 4px;
      margin: 0 auto 12px;
    }
    .patient-block { text-align: center; margin-bottom: 20px; }
    .patient-detail { font-size: 11.5px; color: #444; margin: 3px 0; }
    .approved-text {
      text-align: center;
      font-size: 12.5px;
      color: #333;
      margin-bottom: 8px;
    }
    .agency-program {
      text-align: center;
      font-size: 16px;
      font-weight: bold;
      color: #1a3a5c;
      margin-bottom: 20px;
    }
    .details-table {
      width: 100%;
      max-width: 420px;
      margin: 0 auto 20px;
      border-collapse: collapse;
    }
    .details-table td {
      padding: 4px 8px;
      font-size: 11.5px;
      color: #333;
    }
    .details-table td:first-child { font-weight: bold; width: 140px; }
    .validity {
      text-align: center;
      font-size: 10.5px;
      color: #666;
      font-style: italic;
      margin-bottom: 32px;
      border: 1px dashed #ccc;
      padding: 8px 20px;
      display: inline-block;
    }
    .validity-wrap { text-align: center; }
    .sig-section {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 40px;
      padding-top: 10px;
    }
    .sig-block { text-align: center; width: 220px; }
    .sig-line {
      border-top: 1px solid #1a1a1a;
      margin-bottom: 6px;
    }
    .sig-name { font-size: 12px; font-weight: bold; color: #1a1a1a; }
    .sig-title { font-size: 10px; color: #666; }
    .sig-date-block { text-align: center; width: 160px; }
    .footer {
      margin-top: 30px;
      text-align: center;
      font-size: 9px;
      color: #aaa;
      letter-spacing: 0.5px;
    }
    @media print {
      body { padding: 20px 40px; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    <!-- Replace the SVG below with your actual CRMC logo as a base64 <img> tag -->
    <svg class="seal" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="37" fill="none" stroke="#1a3a5c" stroke-width="2.5"/>
      <circle cx="40" cy="40" r="30" fill="none" stroke="#1a3a5c" stroke-width="1"/>
      <text x="40" y="34" text-anchor="middle" font-size="11" fill="#1a3a5c" font-weight="bold" font-family="serif">CRMC</text>
      <text x="40" y="46" text-anchor="middle" font-size="6.5" fill="#1a3a5c" font-family="serif">COTABATO</text>
      <text x="40" y="55" text-anchor="middle" font-size="5.5" fill="#1a3a5c" font-family="serif">REGIONAL MEDICAL</text>
    </svg>

    <div class="header-text">
      <p class="republic">Republic of the Philippines</p>
      <p class="agency">Cotabato Regional Medical Center</p>
      <p class="sub">Medical Assistance Portal Access (MAPA) &nbsp;·&nbsp; Cotabato City, Maguindanao del Norte</p>
    </div>

    <svg class="seal" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="37" fill="none" stroke="#1a3a5c" stroke-width="2.5"/>
      <circle cx="40" cy="40" r="30" fill="none" stroke="#1a3a5c" stroke-width="1"/>
      <text x="40" y="34" text-anchor="middle" font-size="11" fill="#1a3a5c" font-weight="bold" font-family="serif">CRMC</text>
      <text x="40" y="46" text-anchor="middle" font-size="6.5" fill="#1a3a5c" font-family="serif">COTABATO</text>
      <text x="40" y="55" text-anchor="middle" font-size="5.5" fill="#1a3a5c" font-family="serif">REGIONAL MEDICAL</text>
    </svg>
  </div>

  <hr class="divider" />

  <!-- Title -->
  <p class="cert-title">Guarantee Letter for Medical Assistance</p>
  <p class="cert-sub">Official Approval Document</p>

  <!-- Body -->
  <p class="certify-text">This is to certify that</p>

  <div class="patient-block">
    <div><span class="patient-name">${app.patientName}</span></div>
    ${patient.address ? `<p class="patient-detail">Address: ${patient.address}</p>` : ''}
    <p class="patient-detail">Contact No.: ${app.patientContact || patient.contact || '—'}</p>
    <p class="patient-detail">Hospital ID: ${patient.hospitalId || '—'}</p>
  </div>

  <p class="approved-text">
    has been duly evaluated and <strong>APPROVED</strong> for financial medical assistance<br/>under the program of:
  </p>

  <p class="agency-program">${app.agencyName}</p>

  <hr class="divider-thin" />

  <!-- Guarantee block -->
  <div style="text-align:center; margin: 18px 0 14px;">
    <p style="font-size: 12px; color: #444; margin-bottom: 6px;">
      The bearer is hereby <strong>guaranteed</strong> financial assistance in the amount of:
    </p>
    <p style="font-size: 24px; font-weight: bold; color: #1a3a5c; letter-spacing: 1px; margin-bottom: 6px;">
      &#8369; ${Number(app.approvedAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </p>
    <p style="font-size: 11.5px; color: #444; margin-top: 4px;">
      <strong>For:</strong> ${(app.purposeOfAssistance ?? []).join(', ') || 'Medical assistance'}
    </p>
    <p style="font-size: 11.5px; color: #444; margin-top: 2px;">
      <strong>Payable to:</strong> ${app.payableTo || '—'}
    </p>
  </div>

  <hr class="divider-thin" />

  <!-- Details -->
  <table class="details-table">
    <tr>
      <td>Reference No.:</td>
      <td>${app.appId}</td>
    </tr>
    <tr>
      <td>Date Applied:</td>
      <td>${app.submittedAt ? (app.submittedAt.toDate ? app.submittedAt.toDate() : new Date(app.submittedAt)).toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'}</td>
    </tr>
    <tr>
      <td>Date Approved:</td>
      <td>${approvalDate}</td>
    </tr>
    <tr>
      <td>Date Issued:</td>
      <td>${issueDate}</td>
    </tr>
  </table>

  <hr class="divider-thin" />

  <div class="validity-wrap">
    <span class="validity">
      This Guarantee Letter is valid for <strong>30 days</strong> from date of issuance.<br/>
      The named provider may bill ${app.agencyName} directly up to the guaranteed amount. The patient shall not be liable for the guaranteed portion.
    </span>
  </div>

  <!-- Signatures -->
  <div class="sig-section">
    <div class="sig-block">
      <div class="sig-line"></div>
      <p class="sig-name">${signatory.name}</p>
      <p class="sig-title">${signatory.title}</p>
      <p class="sig-title" style="margin-top:2px;">${app.agencyName}</p>
    </div>
    <div class="sig-date-block">
      <div class="sig-line"></div>
      <p class="sig-name">${issueDate}</p>
      <p class="sig-title">Date Signed</p>
    </div>
  </div>

  <div class="footer">
    Generated by MAPA – Medical Assistance Portal Access &nbsp;·&nbsp; CRMC &nbsp;·&nbsp; ${app.appId}
  </div>

  ${preview ? '' : `<script>window.onload = () => { window.print() }</script>`}
</body>
</html>
`

// ── Main page ─────────────────────────────────────────────────────────────

const formatDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'
}

// Days since a date (whole days). Used to drive the GL aging chip --
// approved-but-unsigned GLs are budget held hostage; once they're a
// few days old the coordinator probably forgot.
const daysSince = (ts) => {
  const d = tsToDate(ts)
  if (!d) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

export default function CertificateGenerator() {
  const { user }          = useAuth()
  const navigate          = useNavigate()
  const [apps, setApps]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [printing, setPrinting] = useState(null)
  const [search, setSearch]     = useState('')

  // Track which apps have an uploaded signed scan
  const [uploaded, setUploaded] = useState({})  // { appId: { fileName, ... } }
  const [uploadModal, setUploadModal] = useState(null)  // { app, existing }

  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(
      collection(db, 'applications'),
      where('agencyId', '==', user.agencyId),
      where('status', 'in', ['approved', 'certificate']),
    )
    const unsub = onSnapshot(q, snap => {
      setApps(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.submittedAt?.seconds ?? 0) - (a.submittedAt?.seconds ?? 0))
      )
      setLoading(false)
    }, (err) => {
      setLoading(false)
      console.error('[CertificateGenerator] applications snapshot error:', err)
      toast.error('Failed to load applications.')
    })
    return unsub
  }, [user?.agencyId])

  // Load uploaded signed scans
  useEffect(() => {
    if (!user?.agencyId) return
    const q = query(collection(db, 'certificates'), where('agencyId', '==', user.agencyId))
    const unsub = onSnapshot(q,
      snap => {
        const map = {}
        snap.docs.forEach(d => { map[d.id] = d.data() })
        setUploaded(map)
      },
      (err) => console.error('[CertificateGenerator] certificates snapshot error:', err),
    )
    return unsub
  }, [user?.agencyId])

  const filtered = apps.filter(a => {
    const q = search.toLowerCase()
    return !q ||
      a.patientName?.toLowerCase().includes(q) ||
      a.appId?.toLowerCase().includes(q)
  })

  const handlePrint = (app) => {
    // Same-tab navigation. GL Viewer has its own 'Back to application'
    // link and its own Print / Save as PDF / Mark as Issued actions.
    // (Previously this used window.open with a dead ?action=print query
    // that the Viewer never read, so the new tab didn't auto-print — the
    // user had to click Print on the new tab anyway. Same fix as the
    // ApplicationDetail handlePrintGL we changed in commit ed4da10.)
    navigate(`/agency/applications/${app.id}/gl`)
  }

  return (
    <Layout breadcrumb="Guarantee Letters">
      <div className="p-4 sm:p-6">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h1 className="page-title">Guarantee Letters</h1>
            <p className="page-sub">Print, sign, and upload Guarantee Letters for approved applications.</p>
          </div>
          <div className="card px-4 py-2 text-center">
            <p className="text-2xl font-bold text-green-600">{loading ? '—' : apps.length}</p>
            <p className="text-xs text-gray-400">Awaiting Guarantee Letter</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-4">
          <MdSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input className="input pl-9 pr-10" placeholder="Search by patient name or application ID..."
            value={search} onChange={e => setSearch(e.target.value)} />
          {search && (
            <button
              onClick={() => setSearch('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Info banner — three explicit steps so a coordinator who's just
            printed knows there's still an offline + an upload + a confirm
            action between them and "done". */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-5 flex items-start gap-2">
          <MdCardMembership size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 leading-relaxed">
            <strong>Workflow:</strong> ① <strong>Print Guarantee Letter</strong> → ② wet-sign on paper → ③ open the GL viewer and click <em>Mark as Issued</em> to advance the application → ④ <strong>Upload the signed scan</strong> so the patient can download it.
          </p>
        </div>

        {/* List */}
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card p-4 animate-pulse flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-gray-100 rounded w-40" />
                  <div className="h-3 bg-gray-100 rounded w-56" />
                </div>
                <div className="h-9 bg-gray-100 rounded-lg w-32" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="card p-12 text-center">
            <MdCheckCircle size={40} className="text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400 font-medium">
              {search ? 'No approved applications match your search.' : 'No applications awaiting Guarantee Letters.'}
            </p>
            {!search && (
              <p className="text-xs text-gray-300 mt-1">
                Approved applications will appear here for Guarantee Letter generation.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(app => {
              const isIssued      = app.status === 'certificate'
              const hasSigned     = !!uploaded[app.id]

              // Single source of truth for the row's state visual. The
              // border + icon-bg + badge all derive from the same `state`
              // so they can never disagree (the prior layout had border,
              // icon, and badge each picking colors independently).
              const state = hasSigned ? 'complete'
                          : isIssued  ? 'awaiting-upload'
                          :             'awaiting-issuance'
              const STATE_VISUAL = {
                'awaiting-issuance': { border: 'border-blue-300',  iconBg: 'bg-blue-50',  iconColor: 'text-blue-500',  badge: 'badge-blue',  label: 'Awaiting issuance' },
                'awaiting-upload':   { border: 'border-amber-300', iconBg: 'bg-amber-50', iconColor: 'text-amber-500', badge: 'badge-amber', label: 'Awaiting signed scan' },
                'complete':          { border: 'border-green-400', iconBg: 'bg-green-50', iconColor: 'text-green-500', badge: 'badge-green', label: 'Complete' },
              }[state]
              // Aging chip: only surfaces on non-complete rows. Three days
              // is a reasonable "you probably forgot" threshold; seven days
              // escalates to red because the committed budget is held
              // hostage by the unsigned/unissued GL.
              const days     = state !== 'complete' ? daysSince(app.approvedAt) : null
              const ageChip  = days == null || days < 3 ? null
                             : days >= 7 ? { cls: 'bg-red-100 text-red-700',     label: `${days}d since approval` }
                             :             { cls: 'bg-amber-100 text-amber-700', label: `${days}d since approval` }
              return (
                <div key={app.id} className={`card p-4 border-l-4 ${STATE_VISUAL.border}`}>
                  <div className="flex items-center gap-4 flex-wrap">

                    {/* Icon */}
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${STATE_VISUAL.iconBg}`}>
                      {hasSigned
                        ? <MdCheckCircle size={20} className={STATE_VISUAL.iconColor} />
                        : <MdCardMembership size={20} className={STATE_VISUAL.iconColor} />}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800">{app.patientName}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        <span className="font-mono">{app.appId}</span>
                        <span className="mx-1.5 text-gray-200">·</span>
                        ₱{Number(app.approvedAmount ?? 0).toLocaleString()}
                        <span className="mx-1.5 text-gray-200">·</span>
                        Approved: {formatDate(app.approvedAt) ?? '—'}
                      </p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className={`badge ${STATE_VISUAL.badge} text-xs`}>{STATE_VISUAL.label}</span>
                        {ageChip && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ageChip.cls}`}>
                            ⚠ {ageChip.label}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2 flex-shrink-0 flex-wrap">
                      <button
                        className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${
                          !isIssued
                            ? 'bg-brand-500 text-white hover:bg-brand-600'
                            : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => handlePrint(app)}
                        disabled={printing === app.id}>
                        <MdPrint size={15} />
                        {printing === app.id ? 'Opening…' : isIssued ? 'Re-print' : 'Print GL'}
                      </button>
                      {isIssued && (
                        <button
                          className={`flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg ${
                            hasSigned
                              ? 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                              : 'bg-brand-500 text-white hover:bg-brand-600'
                          }`}
                          onClick={() => setUploadModal({ app, existing: uploaded[app.id] ?? null })}>
                          <MdUpload size={15} />
                          {hasSigned ? 'Replace signed' : 'Upload signed'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Print confirmation modal */}
        {/* Upload signed scan modal */}
        {uploadModal && (
          <SignedGLUploadModal
            app={uploadModal.app}
            existing={uploadModal.existing}
            onClose={() => setUploadModal(null)}
          />
        )}
      </div>
    </Layout>
  )
}
