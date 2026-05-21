// Build a formal, printable HTML version of the Unified Intake Sheet.
// Mirrors the CRMC paper form: letterhead, sectioned fields as label:value,
// family composition table, narrative blocks, and signature lines.

const peso = (v) => v == null || v === '' ? '—' : `₱${Number(v).toLocaleString()}`

const orDash = (v) => {
  if (v == null) return '<span class="empty">—</span>'
  const s = String(v).trim()
  return s ? s : '<span class="empty">—</span>'
}

const fmtDate = (ts) => {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : new Date(ts)
  if (Number.isNaN(d?.getTime?.())) return '—'
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

const fmtIsoDate = (iso) => {
  if (!iso) return '—'
  const d = new Date(iso + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric' })
}

const meansLabel = (key) => ({
  indigent:        'Indigent',
  marginalized:    'Marginalized',
  low_income:      'Low Income',
  above_threshold: 'Above Threshold',
}[key] ?? '—')

const empLabel = (key) => ({
  employed:        'Employed',
  'self-employed': 'Self-employed',
  unemployed:      'Unemployed',
  retired:         'Retired',
  other:           'Other',
}[key] ?? '—')

const seal = `
  <svg class="seal" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg">
    <circle cx="40" cy="40" r="37" fill="none" stroke="#1a3a5c" stroke-width="2.5"/>
    <circle cx="40" cy="40" r="30" fill="none" stroke="#1a3a5c" stroke-width="1"/>
    <text x="40" y="34" text-anchor="middle" font-size="11" fill="#1a3a5c" font-weight="bold" font-family="serif">CRMC</text>
    <text x="40" y="46" text-anchor="middle" font-size="6.5" fill="#1a3a5c" font-family="serif">COTABATO</text>
    <text x="40" y="55" text-anchor="middle" font-size="5.5" fill="#1a3a5c" font-family="serif">REGIONAL MEDICAL</text>
  </svg>
`

export function buildIntakeSheetHTML({ app, sheet, agency, currentUser }) {
  const s = sheet ?? {}
  const exp = s.expenses ?? {}
  const totalExp = ['food','utilities','rent','education','medicine','other']
    .reduce((sum, k) => sum + (Number(exp[k]) || 0), 0)

  const author = s.completedBy || currentUser?.name || ''

  const familyRows = (s.familyMembers ?? [])
    .filter(m => (m?.name?.trim() || m?.relationship?.trim()))
  while (familyRows.length < 3) familyRows.push({ name: '', relationship: '', age: '', occupation: '', monthlyContribution: '' })

  const familyRowsHTML = familyRows.map(m => `
    <tr>
      <td>${orDash(m.name)}</td>
      <td>${orDash(m.relationship)}</td>
      <td>${orDash(m.age)}</td>
      <td>${orDash(m.occupation)}</td>
      <td style="text-align:right;">${m.monthlyContribution !== '' && m.monthlyContribution != null ? peso(m.monthlyContribution) : '—'}</td>
    </tr>
  `).join('')

  const printDate = new Date().toLocaleDateString('en-PH', {
    year: 'numeric', month: 'long', day: 'numeric',
  })

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Intake Sheet &ndash; ${app.appId}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Times New Roman', Times, serif;
      background: #fff;
      color: #1a1a1a;
      padding: 30px 50px;
      font-size: 12px;
      line-height: 1.45;
    }
    .header {
      display: flex; align-items: center; justify-content: center; gap: 24px;
      margin-bottom: 8px;
    }
    .seal { width: 64px; height: 64px; flex-shrink: 0; }
    .header-text { text-align: center; }
    .republic    { font-size: 10px; letter-spacing: 1.2px; text-transform: uppercase; color: #444; }
    .agency-name { font-size: 17px; font-weight: bold; color: #1a3a5c; line-height: 1.2; margin-top: 2px; }
    .sub         { font-size: 10px; color: #555; margin-top: 2px; }
    .divider     { border: none; border-top: 2px solid #1a3a5c; margin: 10px 0 6px; }
    .title {
      text-align: center; font-size: 17px; font-weight: bold;
      letter-spacing: 1.5px; text-transform: uppercase; color: #1a3a5c;
      margin: 6px 0 2px;
    }
    .subtitle {
      text-align: center; font-size: 10px; letter-spacing: 1.5px;
      text-transform: uppercase; color: #666; margin-bottom: 14px;
    }

    .section-header {
      background: #eef3f8;
      padding: 5px 10px;
      font-weight: bold;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #1a3a5c;
      margin: 14px 0 6px;
      border-left: 3px solid #1a3a5c;
    }

    .field-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 4px 18px;
      margin: 4px 0 2px;
    }
    .field { display: flex; gap: 6px; padding: 3px 0; border-bottom: 1px dotted #ccc; }
    .field.full { grid-column: 1 / -1; }
    .field-label { font-weight: bold; color: #555; min-width: 140px; flex-shrink: 0; }
    .field-value { color: #1a1a1a; flex: 1; word-break: break-word; }
    .empty { color: #aaa; font-style: italic; }

    table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 11px; }
    th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
    th { background: #eef3f8; color: #1a3a5c; font-weight: bold; }

    .narrative {
      padding: 8px 10px; background: #fafafa; border: 1px solid #ddd;
      min-height: 50px; font-size: 11.5px; line-height: 1.5;
      margin: 4px 0; white-space: pre-wrap;
    }
    .narrative.empty-block { color: #aaa; font-style: italic; }

    .means {
      display: inline-block; padding: 3px 10px; background: #eef3f8;
      border: 1px solid #c9d6e4; border-radius: 4px; font-weight: bold;
      color: #1a3a5c; margin-top: 2px;
    }

    .sig-section {
      margin-top: 30px; display: flex; justify-content: space-between;
      gap: 30px; padding-top: 8px;
    }
    .sig-block { flex: 1; text-align: center; }
    .sig-line  { border-top: 1px solid #1a1a1a; margin: 18px 0 4px; }
    .sig-name  { font-size: 11.5px; font-weight: bold; color: #1a1a1a; }
    .sig-title { font-size: 10px; color: #666; margin-top: 2px; }

    .footer {
      margin-top: 24px; text-align: center; font-size: 9px;
      color: #aaa; letter-spacing: 0.5px;
      padding-top: 8px; border-top: 1px solid #eee;
    }

    @media print {
      body { padding: 18px 32px; }
      .section-header { page-break-after: avoid; }
      .sig-section    { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- Header -->
  <div class="header">
    ${seal}
    <div class="header-text">
      <p class="republic">Republic of the Philippines</p>
      <p class="agency-name">Cotabato Regional Medical Center</p>
      <p class="sub">Medical Assistance Portal Access (MAPA)${agency?.name ? ` &nbsp;·&nbsp; ${agency.name}` : ''}</p>
    </div>
    ${seal}
  </div>

  <hr class="divider" />

  <p class="title">Unified Intake Sheet</p>
  <p class="subtitle">Client's Information Sheet &nbsp;·&nbsp; Social Case Study</p>

  <!-- Application reference -->
  <div class="field-grid">
    <div class="field"><span class="field-label">Application No.:</span> <span class="field-value">${app.appId}</span></div>
    <div class="field"><span class="field-label">Date of Application:</span> <span class="field-value">${fmtDate(app.submittedAt)}</span></div>
    <div class="field"><span class="field-label">Agency Program:</span> <span class="field-value">${app.agencyName}</span></div>
    <div class="field"><span class="field-label">Date Printed:</span> <span class="field-value">${printDate}</span></div>
  </div>

  <!-- A. Client Information -->
  <div class="section-header">A. Client Information</div>
  <div class="field-grid">
    <div class="field full"><span class="field-label">Full Name:</span> <span class="field-value">${orDash(app.patientName)}</span></div>
    <div class="field"><span class="field-label">Patient Access Code:</span> <span class="field-value">${orDash(app.accessCode || app.patientAccessCode || '')}</span></div>
    <div class="field"><span class="field-label">Contact No.:</span> <span class="field-value">${orDash(app.patientContact)}</span></div>
    <div class="field full"><span class="field-label">Address:</span> <span class="field-value">${orDash(app.patientAddress)}</span></div>
  </div>

  <!-- B. Family Composition -->
  <div class="section-header">B. Family Composition</div>
  <table>
    <thead>
      <tr>
        <th style="width: 28%;">Name</th>
        <th style="width: 18%;">Relationship</th>
        <th style="width: 8%;">Age</th>
        <th style="width: 24%;">Occupation</th>
        <th style="width: 22%; text-align: right;">Monthly Contrib.</th>
      </tr>
    </thead>
    <tbody>
      ${familyRowsHTML}
    </tbody>
  </table>
  <div class="field" style="margin-top: 4px; border-bottom: none;">
    <span class="field-label">Total Household Size:</span>
    <span class="field-value">${orDash(s.householdSize)}</span>
  </div>

  <!-- C. Income & Employment -->
  <div class="section-header">C. Income &amp; Employment</div>
  <div class="field-grid">
    <div class="field"><span class="field-label">Monthly Household Income:</span> <span class="field-value">${peso(s.monthlyIncome)}</span></div>
    <div class="field"><span class="field-label">Employment Type:</span> <span class="field-value">${empLabel(s.employmentType)}</span></div>
    <div class="field"><span class="field-label">Employer:</span> <span class="field-value">${orDash(s.employer)}</span></div>
    <div class="field"><span class="field-label">Length of Employment:</span> <span class="field-value">${orDash(s.lengthOfEmployment)}</span></div>
    <div class="field full"><span class="field-label">Other Income Source:</span> <span class="field-value">${orDash(s.incomeSource)}</span></div>
  </div>

  <!-- D. Monthly Expenses -->
  <div class="section-header">D. Monthly Expenses</div>
  <div class="field-grid">
    <div class="field"><span class="field-label">Food:</span> <span class="field-value">${peso(exp.food)}</span></div>
    <div class="field"><span class="field-label">Utilities:</span> <span class="field-value">${peso(exp.utilities)}</span></div>
    <div class="field"><span class="field-label">Rent:</span> <span class="field-value">${peso(exp.rent)}</span></div>
    <div class="field"><span class="field-label">Education:</span> <span class="field-value">${peso(exp.education)}</span></div>
    <div class="field"><span class="field-label">Medicine:</span> <span class="field-value">${peso(exp.medicine)}</span></div>
    <div class="field"><span class="field-label">Other:</span> <span class="field-value">${peso(exp.other)}</span></div>
    <div class="field full" style="border-bottom: none; padding-top: 6px;">
      <span class="field-label">Total Monthly Expenses:</span>
      <span class="field-value"><strong>₱${totalExp.toLocaleString()}</strong></span>
    </div>
  </div>

  <!-- E. Medical Information -->
  <div class="section-header">E. Medical Information</div>
  <div class="field-grid">
    <div class="field full"><span class="field-label">Primary Diagnosis:</span> <span class="field-value">${orDash(s.diagnosis)}</span></div>
    <div class="field"><span class="field-label">Attending Physician:</span> <span class="field-value">${orDash(s.attendingPhysician)}</span></div>
    <div class="field"><span class="field-label">Hospital Case No. (IHOMIS):</span> <span class="field-value">${orDash(s.hospitalCaseNumber)}</span></div>
    <div class="field"><span class="field-label">Date of Admission:</span> <span class="field-value">${s.dateOfAdmission ? fmtIsoDate(s.dateOfAdmission) : '—'}</span></div>
    <div class="field"><span class="field-label">Estimated Total Cost:</span> <span class="field-value">${peso(s.estimatedTotalCost)}</span></div>
  </div>

  <!-- F. Social Worker Assessment -->
  <div class="section-header">F. Social Worker Assessment</div>
  <div class="field" style="margin: 4px 0 8px; border-bottom: none;">
    <span class="field-label">Means-Test Category:</span>
    <span class="field-value">${s.meansTestCategory
      ? `<span class="means">${meansLabel(s.meansTestCategory)}</span>`
      : '<span class="empty">— not yet classified —</span>'}</span>
  </div>

  <p style="font-size: 11px; font-weight: bold; color: #555; margin: 10px 0 2px;">Social Case Study Narrative</p>
  <div class="narrative ${s.caseStudyNarrative?.trim() ? '' : 'empty-block'}">${s.caseStudyNarrative?.trim() || '— not provided —'}</div>

  <p style="font-size: 11px; font-weight: bold; color: #555; margin: 10px 0 2px;">Recommendation</p>
  <div class="narrative ${s.recommendation?.trim() ? '' : 'empty-block'}">${s.recommendation?.trim() || '— not provided —'}</div>

  <!-- Signatures -->
  <div class="sig-section">
    <div class="sig-block">
      <div class="sig-line"></div>
      <p class="sig-name">${author || '_________________________'}</p>
      <p class="sig-title">Medical Social Worker</p>
      <p class="sig-title">${app.agencyName}</p>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <p class="sig-name">_________________________</p>
      <p class="sig-title">Verified / Endorsed by</p>
      <p class="sig-title">Supervisor</p>
    </div>
  </div>

  <div class="footer">
    Generated by MAPA &mdash; Medical Assistance Portal Access &nbsp;&middot;&nbsp; CRMC &nbsp;&middot;&nbsp; ${app.appId} &nbsp;&middot;&nbsp; Printed ${printDate}
  </div>

</body>
</html>
`
}
