import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  collection, addDoc, setDoc, doc, serverTimestamp, query, orderBy, where, getDocs,
} from 'firebase/firestore'
import {
  getAuth, createUserWithEmailAndPassword,
  signOut as fbSignOut, sendPasswordResetEmail,
} from 'firebase/auth'
import { initializeApp, getApps } from 'firebase/app'
import { db, auth, firebaseConfig } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'
import { logAudit } from '../../utils/auditLog'
import { notify } from '../../utils/notifications'
import { generateTempPassword } from '../../utils/password'
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
    location:       '',
    phone:          '',
    processingTime: 'Same Day',
    slotsTotal:     25,
  })
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
    if (Number(agency.slotsTotal) < 1) { toast.error('Daily slots must be at least 1.'); return }

    // The first Agency Administrator is mandatory: every agency needs at
    // least one admin who can then add coordinators from the agency portal's
    // Team page (CRMC no longer creates agency members). Without this, a new
    // agency would be stranded with no one able to log in or onboard staff.
    if (!coord.name.trim())        { toast.error('Agency administrator name is required.'); return }
    if (!coord.email.trim())       { toast.error('Agency administrator email is required.'); return }
    if (coord.password.length < 6) { toast.error('Password must be at least 6 characters.'); return }

    setSaving(true)
    try {
      // 1. Create agency
      const slots = Number(agency.slotsTotal)
      const ref = await addDoc(collection(db, 'agencies'), {
        name:           agency.name.trim(),
        initials:       agency.initials.trim().toUpperCase().slice(0, 3),
        color:          agency.color,
        description:    agency.description.trim(),
        location:       agency.location.trim(),
        phone:          agency.phone.trim(),
        processingTime: agency.processingTime,
        requirements:   [...selectedReqs],
        assistanceTypes:[...selectedTypes],
        slots:          { total: slots, remaining: slots },
        enabled:        true,
        createdAt:      serverTimestamp(),
      })

      logAudit(user, {
        action: 'agency_created', targetType: 'agency',
        targetId: ref.id, targetName: agency.name.trim(),
        details: 'New agency registered',
      })

      // Notify admins
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

      // 2. Create the first Agency Administrator (mandatory — see validation
      // above). The senior agency officer who controls allocation and can
      // add coordinators from the agency portal's Team page.
      const secondaryAuth = getSecondaryAuth()
      const cred = await createUserWithEmailAndPassword(secondaryAuth, coord.email.trim(), coord.password)
      const adminUid = cred.user.uid
      await fbSignOut(secondaryAuth)

      await setDoc(doc(db, 'users', adminUid), {
        name:      coord.name.trim(),
        email:     coord.email.trim(),
        role:      'agency_admin',
        agencyId:  ref.id,
        contact:   null,
        rank:      null,
        active:    true,
        cooldown:  0,
        deletion:  false,
        createdAt: serverTimestamp(),
      })

      if (sendReset) await sendPasswordResetEmail(auth, coord.email.trim())

      logAudit(user, {
        action: 'account_created', targetType: 'account', targetId: adminUid,
        targetName: coord.name.trim(),
        details: `First Agency Administrator for ${agency.name.trim()}`,
      })

      toast.success(`${agency.name.trim()} created with its Agency Administrator account.`)
      navigate('/admin/agencies')
    } catch (err) {
      if (err.code === 'auth/email-already-in-use') toast.error('Coordinator email is already registered.')
      else toast.error('Failed to create agency. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <Layout breadcrumb="Add Agency">
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">

        {/* Back */}
        <button
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors mb-5"
          onClick={() => navigate('/admin/agencies')}>
          <MdArrowBack size={16} /> Back to Agencies
        </button>

        <h1 className="page-title mb-1">Add New Agency</h1>
        <p className="page-sub mb-6">
          Set up the agency profile and its first Agency Administrator account in one step.
        </p>

        {/* ── Section 1: Agency Details ── */}
        <div className="card p-6 mb-5 space-y-5">

          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Agency Details</p>

          {/* Live preview */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            <div className={`w-12 h-12 ${agency.color} rounded-xl text-white font-bold text-sm flex items-center justify-center flex-shrink-0`}>
              {agency.initials || '??'}
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-800">{agency.name || 'Agency Name'}</p>
              <p className="text-xs text-gray-400">{agency.location || 'Location'}</p>
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1 flex items-center gap-1">
                <MdLocationOn size={12} className="text-gray-400" /> Location
              </label>
              <input className="input" placeholder="CRMC Ground Floor, Cotabato City"
                value={agency.location} onChange={setA('location')} />
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
              <select className="input" value={agency.processingTime} onChange={setA('processingTime')}>
                {['Same Day', '1–2 Days', '3–5 Days', '5–7 Days', '1–2 Weeks'].map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
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
        <div className="card p-6 mb-6">
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
