// Certificate of Eligibility (2026-11-16; reports/Certificate of Eligibility
// layout.md). No official DOH/Malasakit template exists, so the layout follows
// the DSWD AICS CoE, a hospital (ZCMC) CoE and the AO 2021-0044 assessment
// tool: the Medical Social Worker certifies the patient's AO 2021-0044 class.
// No peso amounts — those belong to each agency's Guarantee Letter and the
// order of charging. MAPA generates it; staff print it, the MSW signs, the
// head notes it, the patient signs the conforme, the office stamps it, and the
// scan is uploaded (eligibilityCertificates/{requestId}__{controlNo}).
// Pure helpers (snapshot + HTML) for tests; the writes live in the UI.
import { esc } from './intakeSheetHTML.js'
import {
  isIntakeComplete, isLegacyCategory, SUPPORTING_CIRCUMSTANCES, LEGACY_MEANS_CATEGORIES,
} from './intakeSheet.js'
import { classificationValidUntil } from './classificationReuse.js'

export const COE_CLASSES = [
  { value: 'indigent_c3',      label: 'Indigent (C3)' },
  { value: 'incapacitated_c2', label: 'Financially Incapacitated (C2)' },
  { value: 'incapacitated_c1', label: 'Financially Incapacitated (C1)' },
  { value: 'capable',          label: 'Financially Capable' },
]

const UNIT_LABEL = {
  dialysis: 'Dialysis Unit', chemotherapy: 'Chemotherapy / Cancer Unit', pharmacy: 'Pharmacy',
  laboratory: 'Laboratory / Imaging', clinic: 'Outpatient Clinic',
}

// CRMC-COE-2026-00001: the hospital's access-code prefix, a yearly sequence.
export const coeNumber = (prefix, year, seq) =>
  `${String(prefix || 'MAPA').toUpperCase()}-COE-${year}-${String(seq).padStart(5, '0')}`

export const counterId = (tenantId, year) => `${tenantId}__${year}`
export const certDocId = (requestId, controlNo) => `${requestId}__${controlNo}`

// Can this request's certificate be generated? { ok, reason }.
export function coeReadiness(request) {
  const s = request?.intakeSheet
  if (!s?.meansTestCategory || !isIntakeComplete(s, request?.totalBill)) {
    return { ok: false, reason: 'Complete the intake sheet assessment first.' }
  }
  if (isLegacyCategory(s.meansTestCategory)) {
    return { ok: false, reason: `Classified "${LEGACY_MEANS_CATEGORIES[s.meansTestCategory]}" on the old scale. Classify again with the DOH AO 2021-0044 classes to issue a certificate.` }
  }
  return { ok: true, reason: '' }
}

const toIso = (ts) => {
  const d = ts?.toDate ? ts.toDate() : typeof ts?.seconds === 'number' ? new Date(ts.seconds * 1000) : ts ? new Date(ts) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null
}

// The assessor's credential from hospitalSettings.coeSocialWorkers (keyed by
// uid): { socialWorkerRsw, socialWorkerLicense }. Unknown → not an RSW.
export function socialWorkerCredential(settings, uid) {
  const sw = uid ? settings?.coeSocialWorkers?.[uid] : null
  return {
    socialWorkerRsw: sw?.rsw === true,
    socialWorkerLicense: sw?.rsw === true ? String(sw.licenseNo ?? '').trim() : '',
  }
}

// The frozen content of one certificate. `patient` is users/{patientId};
// `org` the case hospital's branding; `settings` its hospitalSettings.
export function buildCoeSnapshot({ request, patient = {}, org = {}, settings = {}, controlNo, now = new Date() }) {
  const s = request.intakeSheet ?? {}
  const b = s.classificationBasis
  const until = classificationValidUntil(s)
  return {
    controlNo,
    issuedOn:    now.toISOString(),
    requestRef:  request.requestId ?? request.id ?? '',
    hospital: {
      name:    org.facilityName ?? '',
      address: org.address ?? '',
      office:  org.gatewayName ?? 'Medical Social Service',
    },
    patient: {
      name:      patient.name ?? request.patientName ?? '',
      birthdate: patient.birthdate ?? '',
      sex:       patient.sex ?? '',
      address:   patient.address ?? request.patientAddress ?? '',
    },
    assistanceType:     request.assistanceType ?? '',
    careSetting:        request.careSetting === 'outpatient' ? 'outpatient' : 'inpatient',
    careUnit:           request.careUnit ?? '',
    dateOfAdmission:    s.dateOfAdmission ?? '',
    diagnosis:          s.diagnosis ?? '',
    hospitalCaseNumber: s.hospitalCaseNumber ?? '',
    assessedOn:         toIso(s.completedAt),
    category:           s.meansTestCategory,
    is4Ps:              !!s.is4Ps,
    circumstances: (s.circumstances ?? []).map(v => v === 'other'
      ? (s.circumstancesOther?.trim() || 'Other')
      : (SUPPORTING_CIRCUMSTANCES.find(c => c.value === v)?.label ?? v)),
    basis: b && Number(b.povertyLine) > 0
      ? { povertyLine: Number(b.povertyLine), year: b.year ?? null, region: b.region ?? '', citationShort: b.citationShort ?? '' }
      : null,
    validMonths: Number(s.classificationValidMonths) === 12 ? 12 : 6,
    validUntil:  until ? until.toISOString() : null,
    socialWorker: s.completedBy ?? '',
    // 2026-11-27: ", RSW" and the PRC license number print only for staff the
    // Hospital Admin marked as registered social workers in Hospital Settings
    // (hospitalSettings.coeSocialWorkers[uid]); a certificate never claims a
    // credential MAPA wasn't told about. Looked up by the assessor's uid.
    ...socialWorkerCredential(settings, s.completedByUid),
    // Annex A: "Issued by" the Head of the Medical Social Work Department
    // (stored as coeNotedBy* in hospitalSettings).
    notedBy: {
      name: settings?.coeNotedByName ?? '',
      title: settings?.coeNotedByTitle || 'Head, Medical Social Work Department',
      license: settings?.coeNotedByLicense ?? '',
    },
    representative: request.filedBy?.name
      ? { name: request.filedBy.name, relationship: request.filedBy.relationship ?? '' }
      : null,
  }
}

// What will print as a blank line for hand-filling (Annex A asks only for
// name and address; the hospital case number is MAPA's reference line).
export function coeMissing(snap) {
  const out = []
  if (!snap.patient.address) out.push('address')
  if (!snap.assistanceType) out.push('assistance / service')
  if (!snap.hospitalCaseNumber) out.push('hospital case number')
  // Hospital Settings → Certificate of Eligibility marks who is an RSW.
  if (snap.socialWorker && snap.socialWorkerRsw === false) out.push("the assessor's RSW license (not set in Hospital Settings)")
  else if (snap.socialWorkerRsw && !snap.socialWorkerLicense) out.push("the assessor's license number")
  if (!snap.notedBy?.name) out.push('the issuing head (Hospital Settings)')
  return out
}

const longDate = (iso) => {
  if (!iso) return ''
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-PH', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Manila' })
}
// A filled value, or a blank line to write on.
const fill = (v, width = 140) => (v ? `<strong>${esc(v)}</strong>` : `<span class="blank" style="width:${width}px"></span>`)
// Whole pesos as is; otherwise always two decimals (₱2,691.80, not ₱2,691.8).
const peso = (n) => {
  const v = Number(n)
  return `₱${v.toLocaleString('en-PH', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// The Guarantee Letter's seal (src/components/GuaranteeLetter.jsx) as SVG text:
// the office's initials (Medical Social Services → MSS) over the facility name.
const initialsOf = (office) => String(office ?? '').split(/\s+/)
  .filter(w => w && !/^(of|and|the|&)$/i.test(w)).map(w => w[0]).join('').toUpperCase().slice(0, 5) || 'MSS'
function sealSvg(snap) {
  const mono = esc(initialsOf(snap.hospital?.office))
  const facility = esc(String(snap.hospital?.name ?? '').toUpperCase().slice(0, 40))
  return `<svg class="seal" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <circle cx="40" cy="40" r="37" fill="none" stroke="#1a3a5c" stroke-width="2.5"/>
    <circle cx="40" cy="40" r="30" fill="none" stroke="#1a3a5c" stroke-width="1"/>
    <text x="40" y="${facility ? 38 : 44}" text-anchor="middle" font-size="11" fill="#1a3a5c" font-weight="bold" font-family="serif">${mono}</text>
    ${facility ? `<text x="40" y="50" text-anchor="middle" font-size="4.2" fill="#1a3a5c" font-family="serif">${facility}</text>` : ''}
  </svg>`
}

// ", RSW" after the assessor's name. Certificates generated before
// 2026-11-27 have no socialWorkerRsw and were signed with ", RSW" printed, so a
// reprint keeps it; newer ones show it only for a registered social worker.
const swIsRsw = (snap) => (snap.socialWorkerRsw === undefined ? true : snap.socialWorkerRsw === true)

export function buildEligibilityCertificateHTML(snap) {
  // 2026-11-17: wording follows the Malasakit "Annex A — Certificate of
  // Eligibility (Indigency)" (as transcribed from ZCMC's form; JAO 2020-0001
  // "standard form"), plus MAPA's additions (number, AO 2021-0044 class and
  // basis, validity, 4Ps, conforme, stamp box).
  const outpatient = snap.careSetting === 'outpatient'
  const eligible = snap.category && snap.category !== 'capable'
  const classLabel = COE_CLASSES.find(c => c.value === snap.category)?.label ?? ''
  const service = [snap.assistanceType, outpatient ? UNIT_LABEL[snap.careUnit] : ''].filter(Boolean).join(' — ')
  const basisLine = snap.basis
    ? `Basis of classification: household monthly income per person compared with the PSA monthly per capita poverty threshold for ${esc(snap.basis.region || 'the region')} of ${esc(peso(snap.basis.povertyLine))}${snap.basis.citationShort ? ` (${esc(snap.basis.citationShort)})` : snap.basis.year ? ` (PSA ${esc(snap.basis.year)})` : ''}, per DOH AO 2021-0044, Annex A.`
    : 'Basis of classification: assessment by the Medical Social Worker per DOH AO 2021-0044.'

  // 2026-11-27: laid out like the Guarantee Letter (src/components/GuaranteeLetter.jsx):
  // twin seals, centred header, navy title, the patient's name large, the
  // classification in a bordered block (the GL's amount), a details table, a
  // dashed validity box, centred signatures. The Annex A wording is unchanged.
  const office = snap.hospital.office || 'Medical Social Service'
  const sig = (name, extra = '') => (name ? `${esc(name)}${extra}` : '<span class="blank" style="width:200px"></span>')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificate of Eligibility ${esc(snap.controlNo)}</title>
<style>
  @page { size: A4; margin: 14mm 16mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; color: #1a1a1a; font-size: 12px; line-height: 1.45; margin: 0; background: #fff; }
  p { margin: 0; }
  .doc { max-width: 800px; margin: 0 auto; padding: 28px 48px; }
  .header { display: flex; align-items: center; justify-content: center; gap: 24px; position: relative; }
  .seal { width: 74px; height: 74px; flex-shrink: 0; }
  .header-text { text-align: center; }
  .republic { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #444; }
  .facility { font-size: 18px; font-weight: bold; color: #1a3a5c; line-height: 1.2; margin-top: 2px; text-transform: uppercase; }
  .sub-line { font-size: 11px; color: #555; margin-top: 2px; }
  .office { font-size: 11.5px; font-weight: bold; letter-spacing: 1.5px; color: #1a3a5c; text-transform: uppercase; margin-top: 3px; }
  .annex { position: absolute; right: 0; top: -14px; font-size: 9.5px; color: #666; }
  .divider { border: none; border-top: 2px solid #1a3a5c; margin: 12px 0 8px; }
  .divider-thin { border: none; border-top: 1px solid #ccc; margin: 12px 0; }
  .cert-title { text-align: center; font-size: 20px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #1a3a5c; margin: 8px 0 2px; }
  .cert-sub { text-align: center; font-size: 11px; color: #666; letter-spacing: 1px; text-transform: uppercase; margin-bottom: 16px; }
  .certify-text { text-align: center; font-size: 12px; color: #444; margin-bottom: 10px; }
  .patient-block { text-align: center; margin-bottom: 10px; }
  .patient-name { font-size: 24px; font-weight: bold; text-transform: uppercase; letter-spacing: 2px; border-bottom: 2px solid #1a1a1a; display: inline-block; padding-bottom: 3px; margin-bottom: 6px; }
  .patient-detail { font-size: 11.5px; color: #444; margin: 2px 0; }
  .body-text { text-align: center; font-size: 12.5px; color: #333; margin: 0 auto 8px; max-width: 640px; }
  .class-block { text-align: center; margin: 8px 0 10px; }
  .class-box { display: inline-block; border: 1.5px solid #1a3a5c; background: #f4f7fb; padding: 8px 22px; min-width: 300px; }
  .class-label { font-size: 9.5px; letter-spacing: 1.5px; text-transform: uppercase; color: #1a3a5c; font-weight: bold; margin-bottom: 2px; }
  .class-value { font-size: 22px; font-weight: bold; color: #1a3a5c; letter-spacing: 1px; }
  .class-note { font-size: 11px; color: #444; margin-top: 2px; }
  .details-table { margin: 0 auto 10px; border-collapse: collapse; }
  .details-table td { padding: 3px 8px; font-size: 11.5px; color: #333; vertical-align: top; }
  .details-table td:first-child { font-weight: bold; white-space: nowrap; }
  .basis { font-size: 10.5px; color: #555; text-align: center; max-width: 640px; margin: 0 auto 10px; }
  .validity-wrap { text-align: center; }
  .validity { font-size: 10.5px; color: #555; font-style: italic; border: 1px dashed #bbb; padding: 7px 18px; display: inline-block; max-width: 640px; }
  .sig-section { display: flex; justify-content: space-between; gap: 32px; margin-top: 30px; }
  .sig-block { text-align: center; flex: 1; max-width: 260px; }
  .sig-label { font-size: 10.5px; color: #666; text-align: left; margin-bottom: 26px; }
  .sig-line { border-top: 1px solid #1a1a1a; margin-bottom: 5px; }
  .sig-name { font-size: 12px; font-weight: bold; }
  .sig-title { font-size: 10px; color: #555; }
  .conforme { display: flex; gap: 24px; align-items: flex-end; margin-top: 20px; }
  .conforme .text { flex: 1.6; font-size: 10.5px; color: #333; }
  .conforme .sig-line { margin-top: 28px; }
  .stamp { flex: 1; border: 1px dashed #888; height: 2.6cm; display: flex; align-items: center; justify-content: center; color: #999; font-size: 10.5px; }
  .blank { display: inline-block; border-bottom: 1px solid #1a1a1a; height: 13px; vertical-align: bottom; }
  .gl-footer { margin-top: 16px; border-top: 1px solid #ddd; padding-top: 6px; text-align: center; font-size: 9px; color: #888; letter-spacing: 0.3px; }
  .printbar { display: flex; justify-content: flex-end; gap: 8px; align-items: center; margin-bottom: 18px; font-family: Arial, sans-serif; font-size: 12px; color: #555; }
  .printbar button { font: inherit; font-weight: bold; font-size: 14px; padding: 10px 22px; min-height: 44px; border: 0; border-radius: 8px; background: #1a3a5c; color: #fff; cursor: pointer; }
  @media print { .noprint { display: none; } .doc { padding: 0; max-width: none; } }
</style></head><body><div class="doc">
  <div class="printbar noprint"><span>Print on A4, then sign, stamp and upload the scan.</span><button type="button" id="coe-print-btn">Print</button></div>

  <div class="header">
    ${sealSvg(snap)}
    <div class="header-text">
      <p class="republic">Republic of the Philippines</p>
      <p class="facility">${esc(snap.hospital.name)}</p>
      ${snap.hospital.address ? `<p class="sub-line">${esc(snap.hospital.address)}</p>` : ''}
      <p class="office">${esc(office)}</p>
    </div>
    ${sealSvg(snap)}
    <div class="annex">Malasakit Center Form – Annex A</div>
  </div>

  <hr class="divider" />

  <p class="cert-title">Certificate of Eligibility</p>
  <p class="cert-sub">${eligible ? '(Indigency)' : 'Means-test classification'}</p>

  <p class="certify-text">This is to certify that</p>
  <div class="patient-block">
    <div>${snap.patient.name ? `<span class="patient-name">${esc(snap.patient.name)}</span>` : '<span class="blank" style="width:320px"></span>'}</div>
    <p class="patient-detail">of ${fill(snap.patient.address, 280)}</p>
  </div>

  <p class="body-text">${eligible ? 'is an indigent/needy patient with classification of' : 'has been assessed and is classified as'}</p>
  <div class="class-block"><div class="class-box">
    <p class="class-label">Classification · DOH AO 2021-0044</p>
    <p class="class-value">${esc(classLabel || 'Financially Capable')}</p>
    ${snap.is4Ps ? '<p class="class-note">Member/beneficiary of the Pantawid Pamilyang Pilipino Program (4Ps)</p>' : ''}
  </div></div>
  <p class="body-text">pursuant to Department of Health Administrative Order No. 2021-0044, as assessed by the undersigned Medical Social Worker
  on ${fill(longDate(snap.assessedOn))} on the basis of the Unified Intake Sheet.</p>
  ${eligible ? `<p class="body-text">This certification is issued as a requirement for seeking financial and medical assistance from the Malasakit Center
  especially for the following assistance/service: ${fill(service, 200)} from ${fill(snap.hospital.name, 200)}.</p>` : ''}
  ${snap.circumstances.length ? `<p class="body-text">Supporting circumstances: ${esc(snap.circumstances.join(', '))}.</p>` : ''}

  <hr class="divider-thin" />

  <table class="details-table"><tbody>
    <tr><td>CoE No.:</td><td>${esc(snap.controlNo)}</td></tr>
    <tr><td>Hospital Case No.:</td><td>${fill(snap.hospitalCaseNumber, 140)}</td></tr>
    <tr><td>Date assessed:</td><td>${fill(longDate(snap.assessedOn))}</td></tr>
    <tr><td>Date issued:</td><td>${esc(longDate(snap.issuedOn))}</td></tr>
  </tbody></table>

  <p class="basis">${basisLine}</p>

  <div class="validity-wrap"><span class="validity">
    This classification is valid until ${fill(longDate(snap.validUntil))} (${esc(String(snap.validMonths))} months from the date of assessment), unless reassessed earlier.<br/>
    This certificate is issued on <strong>${esc(longDate(snap.issuedOn))}</strong>. Not valid without signature and office stamp.
  </span></div>

  <div class="sig-section">
    <div class="sig-block">
      <p class="sig-label">Assessed by:</p>
      <div class="sig-line"></div>
      <p class="sig-name">${sig(snap.socialWorker, swIsRsw(snap) ? ', RSW' : '')}</p>
      <p class="sig-title">Medical Social Worker</p>
      <p class="sig-title">License No.: ${fill(snap.socialWorkerLicense, 110)}</p>
    </div>
    <div class="sig-block">
      <p class="sig-label">Issued by:</p>
      <div class="sig-line"></div>
      <p class="sig-name">${sig(snap.notedBy.name)}</p>
      <p class="sig-title">${esc(snap.notedBy.title || 'Head, Medical Social Work Department')}</p>
      <p class="sig-title">License No.: ${fill(snap.notedBy.license, 110)}</p>
    </div>
  </div>

  <div class="conforme">
    <div class="text">
      <strong>CONFORME:</strong> I confirm that the information I provided is true and correct, and I consent to its use and
      sharing with participating agencies for the purpose of medical and financial assistance, under Republic Act No. 10173.
      <div class="sig-line"></div>
      <div>Signature over printed name of patient / representative${snap.representative ? `: <strong>${esc(snap.representative.name)}</strong>` : ''}</div>
      <div>Relationship to patient: ${fill(snap.representative?.relationship ?? '', 110)}&nbsp;&nbsp; Date: <span class="blank" style="width:100px"></span></div>
    </div>
    <div class="stamp">Office stamp / dry seal</div>
  </div>

  <div class="gl-footer">
    Supporting records (Unified Intake Sheet) are confidentially filed with the ${esc(office)}.
    &nbsp;·&nbsp; ${esc(snap.controlNo)} &nbsp;·&nbsp; Request ${esc(snap.requestRef)} &nbsp;·&nbsp; Generated by MAPA
  </div>
</div></body></html>`
}
