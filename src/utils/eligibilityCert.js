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
    // Annex A: "Issued by" the Head of the Medical Social Work Department
    // (stored as coeNotedBy* in hospitalSettings).
    notedBy: { name: settings?.coeNotedByName ?? '', title: settings?.coeNotedByTitle || 'Head, Medical Social Work Department' },
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

  return `<!doctype html><html><head><meta charset="utf-8"><title>Certificate of Eligibility ${esc(snap.controlNo)}</title>
<style>
  @page { size: A4; margin: 18mm 18mm 16mm; }
  body { font-family: 'Times New Roman', Georgia, serif; color: #111; font-size: 13px; line-height: 1.55; margin: 0; }
  .head { text-align: center; border-bottom: 2px solid #111; padding-bottom: 8px; }
  .head .h1 { font-size: 17px; font-weight: bold; text-transform: uppercase; }
  .head .h2 { font-size: 12px; }
  .head .office { font-size: 13px; font-weight: bold; letter-spacing: 1px; margin-top: 4px; text-transform: uppercase; }
  h1 { text-align: center; font-size: 20px; letter-spacing: 2px; margin: 18px 0 6px; }
  h1 .sub { display: block; font-size: 14px; letter-spacing: 1px; margin-top: 2px; }
  .head .annex { position: absolute; right: 0; top: 0; font-size: 10px; color: #444; }
  .head { position: relative; }
  .ref { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 14px; }
  p { margin: 0 0 10px; text-align: justify; }
  .small { font-size: 11px; color: #333; }
  .blank { display: inline-block; border-bottom: 1px solid #111; height: 14px; vertical-align: bottom; }
  .sigs { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 26px; }
  .sig .label { font-size: 12px; }
  .sig .line { border-bottom: 1px solid #111; height: 34px; }
  .sig .name { font-weight: bold; margin-top: 2px; }
  .sig .meta { font-size: 12px; }
  .bottom { display: grid; grid-template-columns: 1.6fr 1fr; gap: 24px; margin-top: 24px; align-items: end; }
  .stamp { border: 1px dashed #888; height: 3cm; display: flex; align-items: center; justify-content: center; color: #999; font-size: 11px; }
  .foot { margin-top: 22px; border-top: 1px solid #999; padding-top: 6px; font-size: 10px; color: #444; display: flex; justify-content: space-between; gap: 12px; }
  @media print { .noprint { display: none; } }
</style></head><body>
  <div class="head">
    <div class="h1">${esc(snap.hospital.name)}</div>
    ${snap.hospital.address ? `<div class="h2">${esc(snap.hospital.address)}</div>` : ''}
    <div class="office">${esc(snap.hospital.office || 'Medical Social Service')}</div>
    <div class="annex">Malasakit Center Form – Annex A</div>
  </div>

  <h1>CERTIFICATE OF ELIGIBILITY${eligible ? '<span class="sub">(INDIGENCY)</span>' : ''}</h1>
  <div class="ref">
    <span>CoE No.: <strong>${esc(snap.controlNo)}</strong></span>
    <span>Date issued: <strong>${esc(longDate(snap.issuedOn))}</strong></span>
    <span>Hospital Case No.: ${fill(snap.hospitalCaseNumber, 110)}</span>
  </div>

  ${eligible
    ? `<p>This is to certify that ${fill(snap.patient.name, 220)} of ${fill(snap.patient.address, 280)} is an indigent/needy patient
  with classification of <strong>${esc(classLabel)}</strong> pursuant to Department of Health Administrative Order No. 2021-0044,
  as assessed by the undersigned Medical Social Worker on ${fill(longDate(snap.assessedOn))} on the basis of the Unified Intake Sheet.</p>
  <p>This certification is issued as a requirement for seeking financial and medical assistance from the Malasakit Center
  especially for the following assistance/service: ${fill(service, 200)} from ${fill(snap.hospital.name, 200)}.</p>`
    : `<p>This is to certify that ${fill(snap.patient.name, 220)} of ${fill(snap.patient.address, 280)} has been assessed by the
  undersigned Medical Social Worker on ${fill(longDate(snap.assessedOn))} on the basis of the Unified Intake Sheet, and is classified as
  <strong>${esc(classLabel || 'Financially Capable')}</strong> pursuant to Department of Health Administrative Order No. 2021-0044.</p>`}

  ${snap.is4Ps ? '<p>The patient is a member/beneficiary of the Pantawid Pamilyang Pilipino Program (4Ps).</p>' : ''}
  ${snap.circumstances.length ? `<p>Supporting circumstances: ${esc(snap.circumstances.join(', '))}.</p>` : ''}

  <p class="small">${basisLine}</p>
  <p>This classification is valid until ${fill(longDate(snap.validUntil))} (${esc(String(snap.validMonths))} months from the date of assessment), unless reassessed earlier.</p>
  <p>This certificate is issued on <strong>${esc(longDate(snap.issuedOn))}</strong>.</p>

  <div class="sigs">
    <div class="sig">
      <div class="label">Assessed by:</div>
      <div class="line"></div>
      <div class="name">${snap.socialWorker ? `${esc(snap.socialWorker)}, RSW` : '<span class="blank" style="width:200px"></span>'}</div>
      <div class="meta">Medical Social Worker</div>
      <div class="meta">Licence No.: <span class="blank" style="width:120px"></span></div>
    </div>
    <div class="sig">
      <div class="label">Issued by:</div>
      <div class="line"></div>
      <div class="name">${snap.notedBy.name ? esc(snap.notedBy.name) : '<span class="blank" style="width:200px"></span>'}</div>
      <div class="meta">${esc(snap.notedBy.title || 'Head, Medical Social Work Department')}</div>
      <div class="meta">Licence No.: <span class="blank" style="width:120px"></span></div>
    </div>
  </div>

  <div class="bottom">
    <div>
      <p class="small"><strong>CONFORME:</strong> I confirm that the information I provided is true and correct, and I consent to its use and
      sharing with participating agencies for the purpose of medical and financial assistance, under Republic Act No. 10173.</p>
      <div class="sig"><div class="line"></div>
        <div class="meta">Signature over printed name of patient / representative${snap.representative ? `: <strong>${esc(snap.representative.name)}</strong>` : ''}</div>
        <div class="meta">Relationship to patient: ${fill(snap.representative?.relationship ?? '', 110)}&nbsp;&nbsp; Date: <span class="blank" style="width:100px"></span></div>
      </div>
    </div>
    <div class="stamp">Office stamp / dry seal</div>
  </div>

  <div class="foot">
    <span>Not valid without signature and office stamp. Supporting records (Unified Intake Sheet) are confidentially filed with the ${esc(snap.hospital.office || 'Medical Social Service')}.</span>
    <span>${esc(snap.controlNo)} · Request ${esc(snap.requestRef)} · Generated by MAPA</span>
  </div>
</body></html>`
}
