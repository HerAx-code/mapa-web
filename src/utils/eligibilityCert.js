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
import { ageOn } from './dohReport.js'

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
    notedBy: { name: settings?.coeNotedByName ?? '', title: settings?.coeNotedByTitle || 'Head, Medical Social Service' },
    representative: request.filedBy?.name
      ? { name: request.filedBy.name, relationship: request.filedBy.relationship ?? '' }
      : null,
  }
}

// What will print as a blank line for hand-filling.
export function coeMissing(snap) {
  const out = []
  if (!snap.patient.birthdate) out.push('birthdate')
  if (!snap.patient.sex) out.push('sex')
  if (!snap.patient.address) out.push('address')
  if (!snap.dateOfAdmission) out.push(snap.careSetting === 'outpatient' ? 'visit date' : 'admission date')
  if (!snap.diagnosis) out.push('diagnosis')
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
const peso = (n) => `₱${Number(n).toLocaleString('en-PH', { maximumFractionDigits: 2 })}`

export function buildEligibilityCertificateHTML(snap) {
  const issued = snap.issuedOn ? new Date(snap.issuedOn) : new Date()
  const age = ageOn(snap.patient.birthdate, issued)
  const sex = snap.patient.sex === 'female' ? 'female' : snap.patient.sex === 'male' ? 'male' : ''
  const outpatient = snap.careSetting === 'outpatient'
  const eligible = snap.category && snap.category !== 'capable'
  const box = (on) => (on ? '&#9746;' : '&#9744;')
  const classes = COE_CLASSES.map(c => `<span class="cls">${box(snap.category === c.value)} ${esc(c.label)}</span>`).join('')
  const where = outpatient
    ? `seen at this hospital's ${fill(UNIT_LABEL[snap.careUnit] ?? 'outpatient service', 160)} on ${fill(longDate(snap.dateOfAdmission))}`
    : `admitted to this hospital on ${fill(longDate(snap.dateOfAdmission))}`
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
  .ref { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 14px; }
  p { margin: 0 0 10px; text-align: justify; }
  .classes { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin: 6px 0 10px 24px; font-size: 14px; }
  .cls { white-space: nowrap; }
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
  </div>

  <h1>CERTIFICATE OF ELIGIBILITY</h1>
  <div class="ref">
    <span>CoE No.: <strong>${esc(snap.controlNo)}</strong></span>
    <span>Date issued: <strong>${esc(longDate(snap.issuedOn))}</strong></span>
    <span>Hospital Case No.: ${fill(snap.hospitalCaseNumber, 110)}</span>
  </div>

  <p>This is to certify that ${fill(snap.patient.name, 220)}, ${fill(age === '' ? '' : String(age), 40)} years old, ${fill(sex, 70)},
  born on ${fill(longDate(snap.patient.birthdate))}, residing at ${fill(snap.patient.address, 260)},
  ${where} with the diagnosis of ${fill(snap.diagnosis, 220)}, has been assessed by the undersigned Medical Social Worker
  on ${fill(longDate(snap.assessedOn))} on the basis of the Unified Intake Sheet, and is hereby classified as:</p>

  <div class="classes">${classes}</div>
  <p>pursuant to Department of Health Administrative Order No. 2021-0044${eligible
    ? ', and is therefore eligible to avail of medical and financial assistance from the Malasakit Center and participating government agencies, subject to their respective guidelines.'
    : '.'}</p>

  ${snap.is4Ps ? '<p>The patient is a member/beneficiary of the Pantawid Pamilyang Pilipino Program (4Ps).</p>' : ''}
  ${snap.circumstances.length ? `<p>Supporting circumstances: ${esc(snap.circumstances.join(', '))}.</p>` : ''}

  <p class="small">${basisLine}</p>
  <p>This classification is valid until ${fill(longDate(snap.validUntil))} (${esc(String(snap.validMonths))} months from the date of assessment), unless reassessed earlier.</p>
  <p>This certification is issued for whatever legal purpose it may serve, particularly for medical and financial assistance.</p>

  <div class="sigs">
    <div class="sig">
      <div class="label">Assessed and certified by:</div>
      <div class="line"></div>
      <div class="name">${snap.socialWorker ? `${esc(snap.socialWorker)}, RSW` : '<span class="blank" style="width:200px"></span>'}</div>
      <div class="meta">Position: <span class="blank" style="width:150px"></span></div>
      <div class="meta">PRC License No.: <span class="blank" style="width:120px"></span></div>
    </div>
    <div class="sig">
      <div class="label">Noted by:</div>
      <div class="line"></div>
      <div class="name">${snap.notedBy.name ? esc(snap.notedBy.name) : '<span class="blank" style="width:200px"></span>'}</div>
      <div class="meta">${esc(snap.notedBy.title || 'Head, Medical Social Service')}</div>
      <div class="meta">PRC License No.: <span class="blank" style="width:120px"></span></div>
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
