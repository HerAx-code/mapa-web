import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import SearchableSelect from '../../components/ui/SearchableSelect'
import AgencyAvatar from '../../components/AgencyAvatar'
import {
  collection, addDoc, setDoc, deleteDoc, doc, serverTimestamp, query, orderBy, where, getDocs,
} from 'firebase/firestore'
import {
  getAuth, createUserWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail, deleteUser,
} from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { db, auth, firebaseConfig } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { notify } from '../../utils/notifications'
import { generateTempPassword } from '../../utils/password'
import AddressPicker from '../../components/AddressPicker'
import {
  MdArrowBack, MdLocationOn, MdPhone, MdVisibility, MdVisibilityOff,
  MdContentCopy, MdRefresh,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Config ────────────────────────────────────────────────────────────────

const COLORS = [
  { value: 'bg-brand-500',  label: 'Teal'   },
  { value: 'bg-purple-600', label: 'Purple' },
  { value: 'bg-red-600',    label: 'Red'    },
  { value: 'bg-blue-600',   label: 'Blue'   },
  { value: 'bg-amber-600',  label: 'Amber'  },
  { value: 'bg-pink-600',   label: 'Pink'   },
  { value: 'bg-indigo-600', label: 'Indigo' },
  { value: 'bg-green-600',  label: 'Green'  },
]

const getSecondaryAuth = () => {
  const existing = getApps().find(a => a.name === 'secondary')
  const app = existing ?? initializeApp(firebaseConfig, 'secondary')
  return getAuth(app)
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function AddAgency() {
  const navigate          = useNavigate()
  const { user }          = useAuth()

  // ── Agency form ──────────────────────────────────────────────────────
  const [agency, setAgency] = useState({
    name:           '',
    initials:       '',
    color:          'bg-brand-500',
    description:    '',
    // R32: structured location replaces the single free-text field.
    // `location` is still derived + saved for backward compat with
    // every render site that reads agency.location today.
    province:       '',
    city:           '',
    officeName:     '',
    phone:          '',
    processingTime: 'Same Day',
    slotsTotal:     25,
  })

  // Derived location string -- "{officeName}, {city}" or just "{city}".
  // Used in the live preview AND saved as agency.location so old code
  // paths (patient/MedicalPrograms, agency cards, etc.) don't have to
  // change to read the structured fields.
  const derivedLocation = [agency.officeName?.trim(), agency.city]
    .filter(Boolean)
    .join(', ')
  const [selectedReqs,  setSelectedReqs]  = useState(new Set())
  const [selectedTypes, setSelectedTypes] = useState(new Set())
  const [docTypesList,  setDocTypesList]  = useState([])
  const [typesList,     setTypesList]     = useState([])

  // ── Coordinator form ─────────────────────────────────────────────────
  const [coord, setCoord]         = useState(() => ({ name: '', email: '', password: generateTempPassword() }))
  const [sendReset, setSendReset] = useState(true)
  const [showPw, setShowPw]       = useState(false)

  const [saving, setSaving] = useState(false)

  const setA = (f) => (e) => setAgency(p => ({ ...p, [f]: e.target.value }))
  const setC = (f) => (e) => setCoord(p => ({ ...p, [f]: e.target.value }))

  const regeneratePw = () => setCoord(p => ({ ...p, password: generateTempPassword() }))
  const copyPw = async () => {
    try { await navigator.clipboard.writeText(coord.password); toast.success('Temporary password copied.') }
    catch { toast.error('Could not copy. Show it and copy manually.') }
  }

  const toggleReq  = (name) => setSelectedReqs(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })
  const toggleType = (name) => setSelectedTypes(prev => { const n = new Set(prev); n.has(name) ? n.delete(name) : n.add(name); return n })

  useEffect(() => {
    Promise.all([
      getDocs(query(collection(db, 'documentTypes'),   orderBy('order', 'asc'))),
      getDocs(query(collection(db, 'assistanceTypes'), orderBy('order', 'asc'))),
    ]).then(([docsSnap, typesSnap]) => {
      setDocTypesList(docsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      setTypesList(typesSnap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(() => {})
  }, [])

  // ── Save ─────────────────────────────────────────────────────────────

  const handleSave = async () => {
    // Validate agency
    if (!agency.name.trim())     { toast.error('Agency name is required.'); return }
    if (!agency.initials.trim()) { toast.error('Initials are required.'); return }
    if (!agency.province)        { toast.error('Province is required.'); return }
    if (!agency.city)            { toast.error('City / Municipality is required.'); return }
    if (Number(agency.slotsTotal) < 1) { toast.error('Daily slots must be at least 1.'); return }

    // The first Agency Administrator is mandatory: every agency needs at
    // least one admin who can then add coordinators from the agency portal's
    // Team page (CRMC no longer creates agency members). Without this, a new
    // agency would be stranded with no one able to log in or onboard staff.
    if (!coord.name.trim())        { toast.error('Agency administrator name is required.'); return }
    if (!coord.email.trim())       { toast.error('Agency administrator email is required.'); return }
    if (coord.password.length < 6) { toast.error('Password must be at least 6 characters.'); return }

    setSaving(true)
    // Order of operations is deliberate:
    //   1. Create the Agency Administrator FIRST (Auth + Firestore profile)
    //      so an 'auth/email-already-in-use' failure doesn't leave an orphan
    //      agency in Firestore with no admin able to log in.
    //   2. Only after the admin succeeds, create the agency doc and link
    //      the admin's profile to it via updateDoc.
    //   3. If the agency creation itself fails after the admin exists,
    //      roll back both the Auth account and the Firestore profile.
    // The previous order created the agency first, then the admin -- a
    // failure on step 2 stranded the agency. Plus the old code signed out
    // of the secondary auth BEFORE setDoc, which made deleteUser
    // unreachable if setDoc failed (the rollback couldn't fire).
    let secondaryAuthCred = null
    let adminUid           = null
    let agencyRef          = null
    try {
      // ── 1a. Create the Agency Administrator's Auth account ──
      const secondaryAuth = getSecondaryAuth()
      secondaryAuthCred   = await createUserWithEmailAndPassword(secondaryAuth, coord.email.trim(), coord.password)
      adminUid            = secondaryAuthCred.user.uid

      // ── 1b. Write the Firestore user profile WHILE still signed in to
      //   the secondary auth, so a setDoc failure can call deleteUser to
      //   roll back the orphan Auth account.
      // agencyId is filled in step 2 once we know the new agency's id;
      // for now write null so the doc validates against the users rules.
      try {
        await setDoc(doc(db, 'users', adminUid), {
          name:      coord.name.trim(),
          email:     coord.email.trim(),
          role:      'agency_admin',
          agencyId:  null,
          contact:   null,
          rank:      null,
          active:    true,
          cooldown:  0,
          deletion:  false,
          createdAt: serverTimestamp(),
        })
      } catch (setDocErr) {
        try { await deleteUser(secondaryAuthCred.user) } catch (cleanupErr) {
          console.error('[AddAgency] orphan Auth rollback failed for', coord.email.trim(), cleanupErr)
        }
        await fbSignOut(secondaryAuth).catch(() => {})
        throw setDocErr
      }
      await fbSignOut(secondaryAuth)

      // ── 2. Create the agency doc, then link the admin's profile. If
      //   either fails, roll back the admin (both Firestore profile + Auth)
      //   so the operator can retry cleanly.
      try {
        const slots = Number(agency.slotsTotal)
        agencyRef = await addDoc(collection(db, 'agencies'), {
          name:           agency.name.trim(),
          initials:       agency.initials.trim().toUpperCase().slice(0, 3),
          color:          agency.color,
          description:    agency.description.trim(),
          // R32: save both structured + derived. Old readers use
          // `location`; new code can prefer `city` + `province` if it
          // wants geo-aware filtering.
          province:       agency.province,
          city:           agency.city,
          officeName:     agency.officeName.trim(),
          location:       derivedLocation,
          phone:          agency.phone.trim(),
          processingTime: agency.processingTime,
          requirements:   [...selectedReqs],
          assistanceTypes:[...selectedTypes],
          slots:          { total: slots, remaining: slots },
          enabled:        true,
          createdAt:      serverTimestamp(),
        })
        // Now stamp the admin's profile with the agencyId.
        await setDoc(doc(db, 'users', adminUid), { agencyId: agencyRef.id }, { merge: true })
      } catch (agencyErr) {
        // Roll back the admin profile we just wrote. We can't deleteUser
        // anymore (signed out of secondary auth above), so the Auth
        // account stays as a permanent orphan -- log it loudly so the
        // operator can clean it up from Firebase Console.
        await deleteDocSafe(doc(db, 'users', adminUid))
        console.error(
          '[AddAgency] agency creation failed after admin Auth was created.',
          'Auth account is orphaned and must be deleted manually from Firebase Console:',
          coord.email.trim(),
          agencyErr,
        )
        throw agencyErr
      }

      // ── 3. Audit + notify + reset email (best-effort; failures here
      //   don't roll back since the agency + admin are fully created). ──
      logAudit(user, {
        action: 'agency_created', targetType: 'agency',
        targetId: agencyRef.id, targetName: agency.name.trim(),
        details: 'New agency registered',
      })
      logAudit(user, {
        action: 'account_created', targetType: 'account', targetId: adminUid,
        targetName: coord.name.trim(),
        details: `First Agency Administrator for ${agency.name.trim()}`,
      })
      try {
        const usersSnap = await getDocs(
          query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin']))
        )
        await Promise.all(usersSnap.docs.map(d =>
          notify(d.id, {
            type:  'new_agency',
            title: 'New Agency Added',
            body:  `"${agency.name.trim()}" has been registered as a new medical assistance agency.`,
          }).catch(() => {})
        ))
      } catch (err) {
        console.error('[AddAgency] admin notify fan-out failed:', err)
      }
      if (sendReset) {
        await sendPasswordResetEmail(auth, coord.email.trim()).catch(err =>
          console.error('[AddAgency] reset email failed:', err)
        )
      }

      toast.success(`${agency.name.trim()} created with its Agency Administrator account.`)
      navigate('/admin/agencies')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('Coordinator email is already registered.')
      else toast.error('Failed to create agency. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // Defensive deleteDoc -- swallows failures so a rollback path doesn't
  // throw on top of the original error. Logged so an operator can clean
  // up manually if needed.
  const deleteDocSafe = async (ref) => {
    try { await deleteDoc(ref) }
    catch (err) { console.error('[AddAgency] rollback deleteDoc failed:', err) }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Layout breadcrumb="Add Agency">
      <div className="w-full p-4 sm:p-6 max-w-[1400px] mx-auto">

        {/* Back */}
        <button
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-5"
          onClick={() => navigate('/admin/agencies')}>
          <MdArrowBack size={16} /> Back to Agencies
        </button>

        <p className="eyebrow">Directory</p>
        <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1 mb-1">Add New Agency</h1>
        <p className="text-sm text-gray-500 mb-6">
          Set up the agency profile and its first Agency Administrator account in one step.
        </p>

        {/* Two-column: the agency profile fills the wider left column; the first
            administrator account sits in a sticky right column, so the "two
            things in one form" reads side by side instead of one long scroll. */}
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-5 items-start mb-6">

        {/* ── Section 1: Agency Details ── */}
        <div className="card p-6 space-y-5">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Agency Details</p>

          {/* Live preview */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <AgencyAvatar
              agency={{ ...agency, initials: agency.initials || '??' }}
              className="w-12 h-12 rounded-xl text-sm"
            />
            <div>
              <p className="text-sm font-semibold text-gray-800">{agency.name || 'Agency Name'}</p>
              <p className="text-xs text-gray-400">{derivedLocation || 'Location'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Agency Name <span className="text-red-400">*</span></label>
              <input className="input" placeholder="Malasakit Center"
                value={agency.name} onChange={setA('name')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Initials <span className="text-red-400">*</span></label>
              <input className="input" placeholder="MC" maxLength={3}
                value={agency.initials} onChange={setA('initials')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
            <textarea className="input resize-none" rows={2}
              placeholder="Brief description of the agency and what it offers…"
              value={agency.description} onChange={setA('description')} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Avatar Color</label>
            <div className="flex gap-2 flex-wrap">
              {COLORS.map(c => (
                <button key={c.value} type="button"
                  onClick={() => setAgency(p => ({ ...p, color: c.value }))}
                  className={`w-7 h-7 rounded-lg ${c.value} border-2 transition-all ${agency.color === c.value ? 'border-gray-800 scale-110' : 'border-transparent'}`}
                  title={c.label} />
              ))}
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest pt-1">Contact & Location</p>

          {/* R32 (refactored R39): Province + City use the shared
              AddressPicker -- same component the patient registration
              and Account Settings forms now use. Barangay is intentionally
              hidden; an agency's office identity comes from the Office /
              Building Name field below (e.g. "CRMC Ground Floor", "BARMM
              Admin Building"), not a barangay. The "Other (not listed)"
              fallback lets us register agencies outside BARMM (NCR HQ,
              regional offices) without changing the schema. */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2 flex items-center gap-1">
              <MdLocationOn size={12} className="text-gray-400" /> Office Location <span className="text-red-400">*</span>
            </label>
            <AddressPicker
              showBarangay={false}
              value={{ province: agency.province, city: agency.city, barangay: '' }}
              onChange={({ province, city }) =>
                setAgency(p => ({ ...p, province, city }))}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                <MdLocationOn size={12} className="text-gray-400" /> Office / Building Name <span className="text-gray-400 font-normal">— optional</span>
              </label>
              <input className="input" placeholder="CRMC Ground Floor"
                value={agency.officeName} onChange={setA('officeName')} />
              <p className="text-xs text-gray-400 mt-0.5">Specific office, floor, or department.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                <MdPhone size={12} className="text-gray-400" /> Phone
              </label>
              <input className="input" placeholder="064-421-2500"
                value={agency.phone} onChange={setA('phone')} />
            </div>
          </div>

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest pt-1">Operations</p>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Processing Time</label>
              <SearchableSelect
                value={agency.processingTime}
                onChange={v => setA('processingTime')({ target: { value: v } })}
                options={['Same Day', '1–2 Days', '3–5 Days', '5–7 Days', '1–2 Weeks'].map(v => ({ value: v, label: v }))} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Daily Slot Capacity</label>
              <input type="number" className="input" min={1} max={500}
                value={agency.slotsTotal} onChange={setA('slotsTotal')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Requirements</label>
            {docTypesList.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No document types defined yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {docTypesList.map(t => (
                  <label key={t.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer select-none transition-colors">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
                      checked={selectedReqs.has(t.name)}
                      onChange={() => toggleReq(t.name)} />
                    <span className="text-xs text-gray-700">{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-2">Assistance Types</label>
            {typesList.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No assistance types defined yet.</p>
            ) : (
              <div className="grid grid-cols-2 gap-1.5">
                {typesList.map(t => (
                  <label key={t.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 cursor-pointer select-none transition-colors">
                    <input type="checkbox" className="w-4 h-4 accent-brand-500 flex-shrink-0"
                      checked={selectedTypes.has(t.name)}
                      onChange={() => toggleType(t.name)} />
                    <span className="text-xs text-gray-700">{t.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Section 2: First Agency Administrator (required) ── */}
        <div className="lg:sticky lg:top-[68px]">
        <div className="card p-6">
          <div className="mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">First Agency Administrator <span className="text-red-400">*</span></p>
            <p className="text-xs text-gray-400 mt-1">
              Required. The senior officer at this agency — they control budget allocation, approve top-up requests, manage their own audit slice, and add coordinators from the agency portal's Team page. Every agency needs one to be usable.
            </p>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Full Name <span className="text-red-400">*</span></label>
                <input className="input" placeholder="Maria Santos"
                  value={coord.name} onChange={setC('name')} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Email Address <span className="text-red-400">*</span></label>
                <input type="email" className="input" placeholder="admin@agency.gov.ph"
                  value={coord.email} onChange={setC('email')} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Temporary Password <span className="text-gray-400 font-normal">(auto-generated)</span></label>
              <div className="relative">
                <input type={showPw ? 'text' : 'password'} readOnly
                  className="input pr-24 font-mono tracking-wide"
                  value={coord.password} />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  <button type="button" title="Show / hide"
                    className="p-1.5 text-gray-400 hover:text-gray-600"
                    onClick={() => setShowPw(p => !p)}>
                    {showPw ? <MdVisibilityOff size={16} /> : <MdVisibility size={16} />}
                  </button>
                  <button type="button" title="Copy"
                    className="p-1.5 text-gray-400 hover:text-brand-500"
                    onClick={copyPw}>
                    <MdContentCopy size={15} />
                  </button>
                  <button type="button" title="Generate a new one"
                    className="p-1.5 text-gray-400 hover:text-brand-500"
                    onClick={regeneratePw}>
                    <MdRefresh size={16} />
                  </button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-1">Auto-generated and secure. The reset email below lets them set their own — copy this only if you'll hand it over in person.</p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
              <input type="checkbox" className="w-4 h-4 accent-brand-500"
                checked={sendReset} onChange={e => setSendReset(e.target.checked)} />
              Send password reset email to the Agency Administrator
            </label>
            <p className="text-xs text-gray-400">
              After creation, this person can add their own coordinators and set the agency's budget allocation.
            </p>
          </div>
        </div>
        </div>{/* /admin sticky column */}
        </div>{/* /two-column grid */}

        {/* ── Actions ── */}
        <div className="flex items-center justify-between">
          <button className="btn-secondary" onClick={() => navigate('/admin/agencies')}>
            Cancel
          </button>
          <button className="btn-primary px-6" onClick={handleSave} disabled={saving}>
            {saving ? 'Creating…' : 'Create Agency'}
          </button>
        </div>

      </div>
    </Layout>
  )
}
