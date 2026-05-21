// Renders the official Guarantee Letter for an approved application.
// All styles are scoped under `.gl-doc` so they don't bleed into the rest of the app.
// Printing this component (via window.print() on the GLViewer page) produces a
// pixel-perfect, vector-graphic, selectable-text PDF when the user picks
// "Save as PDF" as the print destination.

const tsToDate = (ts) => !ts ? null : (ts.toDate ? ts.toDate() : new Date(ts))

const fmtDate = (ts) => {
  const d = tsToDate(ts)
  return d ? d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' }) : '—'
}

function Seal() {
  return (
    <svg className="seal" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="40" r="37" fill="none" stroke="#1a3a5c" strokeWidth="2.5"/>
      <circle cx="40" cy="40" r="30" fill="none" stroke="#1a3a5c" strokeWidth="1"/>
      <text x="40" y="34" textAnchor="middle" fontSize="11" fill="#1a3a5c" fontWeight="bold" fontFamily="serif">CRMC</text>
      <text x="40" y="46" textAnchor="middle" fontSize="6.5" fill="#1a3a5c" fontFamily="serif">COTABATO</text>
      <text x="40" y="55" textAnchor="middle" fontSize="5.5" fill="#1a3a5c" fontFamily="serif">REGIONAL MEDICAL</text>
    </svg>
  )
}

export default function GuaranteeLetter({ app, patient = {}, signatory, approvalDate, issueDate }) {
  if (!app) return null

  const safeApproval = approvalDate
    ?? ((app.stages ?? []).find(s => s.key === 'approved')?.date)
    ?? fmtDate(app.approvedAt)
    ?? new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })

  const safeIssue = issueDate
    ?? new Date().toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })

  const safeSignatory = signatory ?? {
    name:  app.conductedBy || app.approvedBy || 'Authorized Personnel',
    title: app.conductedBy ? 'Medical Social Worker' : 'Agency Coordinator',
  }

  return (
    <div className="gl-doc">
      <style>{`
        .gl-doc, .gl-doc * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }
        .gl-doc {
          font-family: 'Times New Roman', Times, serif;
          background: #fff;
          color: #1a1a1a;
          padding: 40px 60px;
          font-size: 12px;
          line-height: 1.45;
          width: 100%;
          max-width: 800px;
          margin: 0 auto;
        }
        .gl-doc p { margin: 0; padding: 0; }
        .gl-doc .header {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 24px;
          margin-bottom: 12px;
        }
        .gl-doc .seal { width: 80px; height: 80px; flex-shrink: 0; }
        .gl-doc .header-text { text-align: center; }
        .gl-doc .republic { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #444; }
        .gl-doc .agency-name { font-size: 18px; font-weight: bold; color: #1a3a5c; line-height: 1.2; margin-top: 2px; }
        .gl-doc .sub-line { font-size: 11px; color: #555; margin-top: 2px; }
        .gl-doc .divider { border: none; border-top: 2px solid #1a3a5c; margin: 14px 0 10px; }
        .gl-doc .divider-thin { border: none; border-top: 1px solid #ccc; margin: 14px 0; }
        .gl-doc .cert-title {
          text-align: center;
          font-size: 20px;
          font-weight: bold;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #1a3a5c;
          margin: 10px 0 4px;
        }
        .gl-doc .cert-sub {
          text-align: center;
          font-size: 11px;
          color: #666;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-bottom: 20px;
        }
        .gl-doc .certify-text { text-align: center; font-size: 12px; color: #444; margin-bottom: 18px; }
        .gl-doc .patient-block { text-align: center; margin-bottom: 20px; }
        .gl-doc .patient-name {
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
        .gl-doc .patient-detail { font-size: 11.5px; color: #444; margin: 3px 0; }
        .gl-doc .approved-text { text-align: center; font-size: 12.5px; color: #333; margin-bottom: 8px; }
        .gl-doc .agency-program { text-align: center; font-size: 16px; font-weight: bold; color: #1a3a5c; margin-bottom: 20px; }
        .gl-doc .guarantee-block { text-align: center; margin: 18px 0 14px; }
        .gl-doc .guarantee-intro { font-size: 12px; color: #444; margin-bottom: 6px; }
        .gl-doc .guarantee-amount { font-size: 24px; font-weight: bold; color: #1a3a5c; letter-spacing: 1px; margin: 6px 0; }
        .gl-doc .guarantee-detail { font-size: 11.5px; color: #444; margin-top: 4px; }
        .gl-doc .details-table {
          width: 100%;
          max-width: 420px;
          margin: 0 auto 20px;
          border-collapse: collapse;
        }
        .gl-doc .details-table td { padding: 4px 8px; font-size: 11.5px; color: #333; }
        .gl-doc .details-table td:first-child { font-weight: bold; width: 140px; }
        .gl-doc .validity-wrap { text-align: center; }
        .gl-doc .validity {
          font-size: 10.5px;
          color: #666;
          font-style: italic;
          margin-bottom: 32px;
          border: 1px dashed #ccc;
          padding: 8px 20px;
          display: inline-block;
        }
        .gl-doc .sig-section {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          margin-top: 40px;
          padding-top: 10px;
        }
        .gl-doc .sig-block { text-align: center; width: 220px; }
        .gl-doc .sig-date-block { text-align: center; width: 160px; }
        .gl-doc .sig-line { border-top: 1px solid #1a1a1a; margin-bottom: 6px; }
        .gl-doc .sig-name { font-size: 12px; font-weight: bold; color: #1a1a1a; }
        .gl-doc .sig-title { font-size: 10px; color: #666; }
        .gl-doc .gl-footer {
          margin-top: 30px;
          text-align: center;
          font-size: 9px;
          color: #aaa;
          letter-spacing: 0.5px;
        }

        @media print {
          .gl-doc {
            padding: 20px 40px;
            max-width: none;
          }
        }
      `}</style>

      {/* Header */}
      <div className="header">
        <Seal />
        <div className="header-text">
          <p className="republic">Republic of the Philippines</p>
          <p className="agency-name">Cotabato Regional Medical Center</p>
          <p className="sub-line">Medical Assistance Portal Access (MAPA) &nbsp;·&nbsp; Cotabato City, Maguindanao del Norte</p>
        </div>
        <Seal />
      </div>

      <hr className="divider" />

      {/* Title */}
      <p className="cert-title">Guarantee Letter for Medical Assistance</p>
      <p className="cert-sub">Official Approval Document</p>

      {/* Patient */}
      <p className="certify-text">This is to certify that</p>
      <div className="patient-block">
        <div><span className="patient-name">{app.patientName}</span></div>
        {patient.address && <p className="patient-detail">Address: {patient.address}</p>}
        <p className="patient-detail">Contact No.: {app.patientContact || patient.contact || '—'}</p>
        <p className="patient-detail">Hospital ID: {patient.hospitalId || '—'}</p>
      </div>

      <p className="approved-text">
        has been duly evaluated and <strong>APPROVED</strong> for financial medical assistance<br/>under the program of:
      </p>
      <p className="agency-program">{app.agencyName}</p>

      <hr className="divider-thin" />

      {/* Guarantee block */}
      <div className="guarantee-block">
        <p className="guarantee-intro">
          The bearer is hereby <strong>guaranteed</strong> financial assistance in the amount of:
        </p>
        <p className="guarantee-amount">
          ₱ {Number(app.approvedAmount ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="guarantee-detail">
          <strong>For:</strong> {(app.purposeOfAssistance ?? []).join(', ') || 'Medical assistance'}
        </p>
        <p className="guarantee-detail">
          <strong>Payable to:</strong> {app.payableTo || '—'}
        </p>
      </div>

      <hr className="divider-thin" />

      {/* Details */}
      <table className="details-table">
        <tbody>
          <tr><td>Reference No.:</td><td>{app.appId}</td></tr>
          <tr><td>Date Applied:</td><td>{fmtDate(app.submittedAt)}</td></tr>
          <tr><td>Date Approved:</td><td>{safeApproval}</td></tr>
          <tr><td>Date Issued:</td><td>{safeIssue}</td></tr>
        </tbody>
      </table>

      <hr className="divider-thin" />

      <div className="validity-wrap">
        <span className="validity">
          This Guarantee Letter is valid for <strong>30 days</strong> from date of issuance.<br/>
          The named provider may bill {app.agencyName} directly up to the guaranteed amount.
          The patient shall not be liable for the guaranteed portion.
        </span>
      </div>

      {/* Signatures */}
      <div className="sig-section">
        <div className="sig-block">
          <div className="sig-line"></div>
          <p className="sig-name">{safeSignatory.name}</p>
          <p className="sig-title">{safeSignatory.title}</p>
          <p className="sig-title" style={{ marginTop: 2 }}>{app.agencyName}</p>
        </div>
        <div className="sig-date-block">
          <div className="sig-line"></div>
          <p className="sig-name">{safeIssue}</p>
          <p className="sig-title">Date Signed</p>
        </div>
      </div>

      <div className="gl-footer">
        Generated by MAPA &mdash; Medical Assistance Portal Access &nbsp;&middot;&nbsp; CRMC &nbsp;&middot;&nbsp; {app.appId}
      </div>
    </div>
  )
}
