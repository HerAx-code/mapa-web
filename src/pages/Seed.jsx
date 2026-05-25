import { useState } from 'react'
import { createUserWithEmailAndPassword, signOut, signInWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc, addDoc, collection, getDocs, deleteDoc, writeBatch } from 'firebase/firestore'
import { auth, db } from '../firebase'

const SEED_AGENCIES = [
  { id: 'malasakit', name: 'Malasakit Center',  initials: 'MC', color: 'bg-brand-500',  description: 'Consolidates DOH, DSWD, PhilHealth, and PCSO services for zero balance billing of indigent patients.', location: 'CRMC Ground Floor, Cotabato City', phone: '064-421-2500', slots: { total: 25, remaining: 25 }, requirements: ['Barangay Certificate of Indigency','Hospital Billing Statement','Valid ID','Medical Abstract'], assistanceTypes: ['Hospital Bills / Hospitalization','Medicines','Laboratory Tests'], processingTime: 'Same Day', enabled: true },
  { id: 'ambag',     name: 'AMBaG Program',      initials: 'AM', color: 'bg-purple-600', description: 'Zero balance billing for marginalized patients at CRMC and partner hospitals under the BARMM government.', location: 'BARMM Admin Building, Cotabato City', phone: '064-421-3000', slots: { total: 25, remaining: 25 }, requirements: ['Barangay Certificate of Indigency','PhilHealth ID','Valid ID'], assistanceTypes: ['Hospital Bills / Hospitalization','Medicines'], processingTime: '3–5 Days', enabled: true },
  { id: 'pcso',      name: 'PCSO MAP',            initials: 'PC', color: 'bg-red-600',    description: 'Issues guarantee letters covering chemotherapy, radiation therapy, and essential medicines.', location: 'Social Services Department, CRMC', phone: '064-421-2600', slots: { total: 20, remaining: 20 }, requirements: ['Medical Certificate','Laboratory Results','PhilHealth ID','Valid ID'], assistanceTypes: ['Chemotherapy','Medicines','Laboratory Tests'], processingTime: '5–7 Days', enabled: true },
  { id: 'dswd',      name: 'DSWD AICS',           initials: 'DS', color: 'bg-blue-600',   description: 'Cash assistance and medicine vouchers for individuals in crisis situations through community social workers.', location: 'Social Welfare Office, CRMC', phone: '064-421-2700', slots: { total: 25, remaining: 25 }, requirements: ['Barangay Certificate of Indigency','Valid ID','Crisis Documentation'], assistanceTypes: ['Hospital Bills / Hospitalization','Medicines','Emergency Medical Assistance'], processingTime: 'Same Day', enabled: true },
]

const SEED_DOC_TYPES = [
  { name: 'Valid ID',                          description: 'Any government-issued ID',                    required: true,  order: 0 },
  { name: 'Barangay Certificate of Indigency', description: 'Issued by the barangay',                      required: true,  order: 1 },
  { name: 'Hospital Billing Statement',        description: 'Statement of account from the hospital',       required: true,  order: 2 },
  { name: 'Medical Abstract',                  description: 'Summary of medical condition and treatment',   required: false, order: 3 },
  { name: 'PhilHealth ID',                     description: 'PhilHealth membership card',                   required: false, order: 4 },
  { name: 'Medical Certificate',               description: 'Certified by a licensed physician',            required: false, order: 5 },
  { name: 'Laboratory Results',                description: 'Latest diagnostic or lab results',             required: false, order: 6 },
  { name: 'Crisis Documentation',              description: 'Documentation proving crisis situation',        required: false, order: 7 },
]

const SEED_ASSISTANCE_TYPES = [
  { name: 'Hospital Bills / Hospitalization', description: 'Financial assistance for hospital confinement and related expenses', order: 0 },
  { name: 'Medicines',                        description: 'Support for prescription medications',                               order: 1 },
  { name: 'Chemotherapy',                     description: 'Support for cancer treatment and chemotherapy sessions',             order: 2 },
  { name: 'Dialysis',                         description: 'Assistance for kidney dialysis treatments',                         order: 3 },
  { name: 'Laboratory Tests',                 description: 'Coverage for diagnostic tests and laboratory procedures',            order: 4 },
  { name: 'Surgery / Medical Procedures',     description: 'Financial support for surgical operations',                         order: 5 },
  { name: 'Emergency Medical Assistance',     description: 'Immediate support for emergency medical situations',                 order: 6 },
  { name: 'Burial Assistance',                description: 'Financial support for funeral and burial expenses',                  order: 7 },
]

const SEED_USERS = [
  {
    email: 'admin@crmc.gov.ph', password: 'admin123',
    profile: { name: 'Super Admin', role: 'super_admin', rank: 'high', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },
  {
    email: 'staff@crmc.gov.ph', password: 'staff123',
    profile: { name: 'Staff Admin', role: 'staff_admin', rank: 'low', agencyId: null, contact: null, cooldown: 0, deletion: false },
  },
  // Agency Admins — one per agency. Has access to /agency/allocation,
  // /agency/audit, and /agency/team in addition to all coordinator pages.
  {
    email: 'admin@malasakit.gov.ph',       password: 'agency123',
    profile: { name: 'Dr. Roberto Velasco',     role: 'agency_admin', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@ambag.gov.ph',           password: 'agency123',
    profile: { name: 'Bai Sittie Mamondiong',   role: 'agency_admin', agencyId: 'ambag',     rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@pcso.gov.ph',            password: 'agency123',
    profile: { name: 'Dr. Carmen Reyes',         role: 'agency_admin', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'admin@dswd.gov.ph',            password: 'agency123',
    profile: { name: 'Datu Hakim Sangcopan',     role: 'agency_admin', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  // Agency Coordinators — one per agency. Frontline application reviewers.
  {
    email: 'coordinator@malasakit.gov.ph', password: 'agency123',
    profile: { name: 'Maria Santos',    role: 'agency', agencyId: 'malasakit', rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@ambag.gov.ph',     password: 'agency123',
    profile: { name: 'Ahmad Dimaporo', role: 'agency', agencyId: 'ambag',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@pcso.gov.ph',      password: 'agency123',
    profile: { name: 'Leonora Guia',    role: 'agency', agencyId: 'pcso',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'coordinator@dswd.gov.ph',      password: 'agency123',
    profile: { name: 'Fatima Macalawi', role: 'agency', agencyId: 'dswd',      rank: null, contact: null, cooldown: 0, deletion: false, active: true },
  },
  {
    email: 'patient@gmail.com', password: 'patient123',
    profile: { name: 'Baher Blah', role: 'patient', agencyId: null, rank: null, contact: '09324324344', hospitalId: 'CRMC-2026-00014', patientId: 'PAT-013', cooldown: 0, deletion: false },
  },
]

const SEED_IDS = [
  'CRMC-2026-00001', 'CRMC-2026-00002', 'CRMC-2026-00003',
  'CRMC-2026-00004', 'CRMC-2026-00005', 'CRMC-2026-00006',
  'CRMC-2026-00007', 'CRMC-2026-00008', 'CRMC-2026-00009',
  'CRMC-2026-00010', 'CRMC-2026-00011', 'CRMC-2026-00012',
  'CRMC-2026-00013', 'CRMC-2026-00014', 'CRMC-2026-00015',
  'CRMC-2026-00016', 'CRMC-2026-00017', 'CRMC-2026-00018',
  'CRMC-2026-00019', 'CRMC-2026-00020',
]

export default function Seed() {
  if (import.meta.env.VITE_ENABLE_SEED !== 'true') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="card p-8 max-w-sm text-center">
          <p className="text-3xl mb-3">🔒</p>
          <p className="text-base font-semibold text-gray-800 mb-1">Seed Disabled</p>
          <p className="text-sm text-gray-500">
            The seed page is disabled in this environment.
            Set <code className="bg-gray-100 px-1 rounded">VITE_ENABLE_SEED=true</code> to enable it.
          </p>
        </div>
      </div>
    )
  }
  const [log, setLog]     = useState([])
  const [running, setRunning] = useState(false)
  const [done, setDone]   = useState(false)

  const push = (msg) => setLog(prev => [...prev, msg])

  const handleSeed = async () => {
    setRunning(true)
    setLog([])

    // 1. Create auth accounts + Firestore profiles
    for (const u of SEED_USERS) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, u.email, u.password)
        await setDoc(doc(db, 'users', cred.user.uid), { ...u.profile, email: u.email, active: true, createdAt: new Date() })
        await signOut(auth)
        push(`✅ Created user: ${u.email}`)
      } catch (err) {
        if (err.code === 'auth/email-already-in-use') push(`⚠️ Already exists: ${u.email}`)
        else push(`❌ Failed ${u.email}: ${err.message}`)
      }
    }

    // 2. Sign in as super admin before writing privileged collections
    try {
      await signInWithEmailAndPassword(auth, 'admin@crmc.gov.ph', 'admin123')
      push('✅ Signed in as Super Admin')
    } catch (e) { push(`⚠️ Admin sign-in failed: ${e.message}`) }

    // 3. Seed Hospital IDs
    for (const id of SEED_IDS) {
      try {
        await setDoc(doc(db, 'hospitalIds', id), {
          status: 'available', usedBy: null, patId: null,
          date: new Date().toLocaleDateString(), time: '',
        }, { merge: true })
      } catch (err) {
        push(`❌ Failed ID ${id}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${SEED_IDS.length} Hospital IDs`)

    // 2b. Patch existing users missing active field
    try {
      const { getDocs, collection: col, query: q, where, updateDoc, doc } = await import('firebase/firestore')
      const snap = await getDocs(q(col(db, 'users'), where('active', '==', null)))
      // Also patch any user where active is simply not set
      const all = await getDocs(col(db, 'users'))
      for (const d of all.docs) {
        if (d.data().active === undefined) {
          await updateDoc(doc(db, 'users', d.id), { active: true })
        }
      }
      push('✅ Patched existing users with active field')
    } catch (e) { push(`⚠️ Patch skipped: ${e.message}`) }

    // 3. Seed Agencies
    for (const agency of SEED_AGENCIES) {
      try {
        await setDoc(doc(db, 'agencies', agency.id), agency, { merge: true })
      } catch (err) {
        push(`❌ Failed agency ${agency.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${SEED_AGENCIES.length} Agencies`)

    // 4a. Clear existing doc types and assistance types to prevent duplicates
    try {
      const clearCollection = async (col) => {
        const snap = await getDocs(collection(db, col))
        if (snap.empty) return
        const batch = writeBatch(db)
        snap.docs.forEach(d => batch.delete(d.ref))
        await batch.commit()
      }
      await clearCollection('documentTypes')
      await clearCollection('assistanceTypes')
      push('✅ Cleared existing document types and assistance types')
    } catch (e) { push(`⚠️ Clear skipped: ${e.message}`) }

    // 4. Seed Document Types (deterministic IDs — safe to re-run)
    for (const dt of SEED_DOC_TYPES) {
      try {
        const id = dt.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        await setDoc(doc(db, 'documentTypes', id), { ...dt, createdAt: new Date() }, { merge: true })
      } catch (err) {
        push(`❌ Failed doc type ${dt.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${SEED_DOC_TYPES.length} Document Types`)

    // 5. Seed Assistance Types (deterministic IDs — safe to re-run)
    for (const at of SEED_ASSISTANCE_TYPES) {
      try {
        const id = at.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')
        await setDoc(doc(db, 'assistanceTypes', id), { ...at, createdAt: new Date() }, { merge: true })
      } catch (err) {
        push(`❌ Failed assistance type ${at.name}: ${err.message}`)
      }
    }
    push(`✅ Seeded ${SEED_ASSISTANCE_TYPES.length} Assistance Types`)


    setRunning(false)
    setDone(true)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-md card p-6">
        <h1 className="text-lg font-bold text-gray-800 mb-1">Database Seeder</h1>
        <p className="text-xs text-gray-500 mb-4">
          Creates admin, agency coordinator accounts, and seeds reference data. Safe to re-run — uses merge for most records.
        </p>

        {!done && (
          <button
            className="btn-primary w-full py-2.5 mb-4"
            onClick={handleSeed}
            disabled={running}
          >
            {running ? 'Seeding...' : 'Seed Database'}
          </button>
        )}

        {log.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 text-xs font-mono space-y-1 max-h-60 overflow-y-auto">
            {log.map((l, i) => <div key={i} className="text-green-400">{l}</div>)}
          </div>
        )}

        {done && (
          <div className="mt-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700 font-medium text-center">
            Seeding complete! <a href="/login" className="underline">Go to Login →</a>
          </div>
        )}
      </div>
    </div>
  )
}
