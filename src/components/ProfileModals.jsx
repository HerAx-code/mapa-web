import { useState, useRef, useEffect } from 'react'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs, query, where } from 'firebase/firestore'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { db, auth } from '../firebase'
import { notify } from '../utils/notifications'

// Resize + crop image to 200×200 and return a Base64 JPEG string
const resizeToBase64 = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = reject
  reader.onload = (e) => {
    const img = new Image()
    img.onerror = reject
    img.onload = () => {
      const SIZE = 200
      const canvas = document.createElement('canvas')
      canvas.width  = SIZE
      canvas.height = SIZE
      const ctx = canvas.getContext('2d')
      // center-crop to square
      const min = Math.min(img.width, img.height)
      const sx  = (img.width  - min) / 2
      const sy  = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE)
      resolve(canvas.toDataURL('image/jpeg', 0.75))
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
})
import { useAuth } from '../contexts/AuthContext'
import {
  MdClose, MdVisibility, MdVisibilityOff, MdCameraAlt,
  MdPerson, MdLock, MdPhone, MdHome, MdEmail,
  MdCheckCircle, MdDelete, MdWarning,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Shared modal wrapper ──────────────────────────────────────────────────

function ModalCard({ title, onClose, children, footer }) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[90vh] flex flex-col">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <MdClose size={20} />
        </button>
      </div>
      <div className="px-5 py-4 overflow-y-auto flex-1">{children}</div>
      {footer && <div className="px-5 pb-4 pt-2 flex gap-2 justify-end border-t border-gray-50 flex-shrink-0">{footer}</div>}
    </div>
  )
}

// ── Account Settings ──────────────────────────────────────────────────────

function AccountSettingsModal({ onClose }) {
  const { user, updateUser } = useAuth()
  const fileRef = useRef(null)

  const [form, setForm] = useState({
    name:    user?.name    ?? '',
    contact: user?.contact ?? '',
    address: user?.address ?? '',
  })
  const [photoFile, setPhotoFile]     = useState(null)
  const [photoPreview, setPhotoPreview] = useState(user?.photoURL ?? null)
  const [removePhoto, setRemovePhoto]   = useState(false)
  const [saving, setSaving]             = useState(false)
  const [agencyName, setAgencyName]     = useState(null)

  const avatarClass = (() => {
    switch (user?.role) {
      case 'patient':       return 'bg-brand-50 text-brand-600'
      case 'agency':        return 'bg-blue-50 text-blue-600'
      case 'agency_admin':  return 'bg-teal-50 text-teal-600'
      case 'super_admin':
      case 'staff_admin':   return 'bg-purple-50 text-purple-600'
      default:              return 'bg-gray-100 text-gray-600'
    }
  })()

  const isPatient = user?.role === 'patient'
  const isAgency  = user?.role === 'agency' || user?.role === 'agency_admin'
  const isAdmin   = user?.role === 'super_admin' || user?.role === 'staff_admin'
  // Only patients need a complete address (it appears on their GL); the
  // banner is irrelevant for admin/agency.
  const isIncomplete = isPatient && !form.address.trim()

  const ROLE_LABEL = {
    super_admin:  'Super Administrator',
    staff_admin:  'Staff Administrator',
    agency_admin: 'Agency Administrator',
    agency:       'Agency Coordinator',
    patient:      'Patient',
  }

  // For agency coordinators, fetch the linked agency name to display in Account Info
  useEffect(() => {
    if (!isAgency || !user?.agencyId) return
    getDoc(doc(db, 'agencies', user.agencyId))
      .then(snap => snap.exists() && setAgencyName(snap.data().name))
      .catch(() => {})
  }, [isAgency, user?.agencyId])

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))

  const handlePhotoChange = (e) => {
    const file = e.target.files[0]
    if (!file) return
    if (!file.type.startsWith('image/')) { toast.error('Please select an image file.'); return }
    if (file.size > 10 * 1024 * 1024)   { toast.error('Photo must be under 10MB.'); return }
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    setRemovePhoto(false)
  }

  const handleRemovePhoto = () => {
    setPhotoFile(null)
    setPhotoPreview(null)
    setRemovePhoto(true)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = async () => {
    if (!isPatient && !form.name.trim()) { toast.error('Name cannot be empty.'); return }
    setSaving(true)
    try {
      let photoURL = user?.photoURL ?? null

      if (!isPatient) {
        if (photoFile)    photoURL = await resizeToBase64(photoFile)
        if (removePhoto)  photoURL = null
      }

      const updates = {
        contact: form.contact.trim(),
        address: form.address.trim(),
        photoURL,
      }
      if (!isPatient) updates.name = form.name.trim()

      await updateDoc(doc(db, 'users', user.uid), updates)
      updateUser({ ...updates, name: isPatient ? user.name : form.name.trim() })
      toast.success('Profile updated.')
      onClose()
    } catch (err) {
      toast.error('Failed to update profile.')
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const initials = form.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <ModalCard
      title="Account Settings"
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </>
      }
    >
      {/* Incomplete profile banner (patients only) */}
      {isIncomplete && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            Your address is missing. A complete address appears on your Guarantee Letter — fill it in to avoid delays at the provider.
          </p>
        </div>
      )}

      {/* ── Avatar section ── */}
      <div className="flex flex-col items-center mb-6">
        <div className={`relative ${!isPatient ? 'group' : ''} mb-3`}>
          <div className={`w-24 h-24 rounded-full overflow-hidden border-4 border-white shadow-lg flex items-center justify-center ${avatarClass}`}>
            {photoPreview
              ? <img src={photoPreview} alt="avatar" className="w-full h-full object-cover" />
              : <span className="text-2xl font-bold">{initials}</span>
            }
          </div>
          {!isPatient && (
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MdCameraAlt size={24} className="text-white" />
            </button>
          )}
        </div>

        <p className="text-sm font-semibold text-gray-800">{form.name || '—'}</p>
        <p className="text-xs text-gray-400 mb-3">{user?.email}</p>

        {!isPatient && (
          <div className="flex gap-2">
            <button
              onClick={() => fileRef.current?.click()}
              className="text-xs text-brand-500 font-medium border border-brand-200 px-3 py-1.5 rounded-lg hover:bg-brand-50 transition-colors flex items-center gap-1"
            >
              <MdCameraAlt size={13} /> Change Photo
            </button>
            {photoPreview && (
              <button
                onClick={handleRemovePhoto}
                className="text-xs text-red-500 font-medium border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1"
              >
                <MdDelete size={13} /> Remove
              </button>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        {!isPatient && (
          <p className="text-xs text-gray-400 mt-1.5">JPG, PNG or GIF · Auto-resized to 200×200</p>
        )}
      </div>

      <div className="border-t border-gray-100 mb-4" />

      {/* ── Personal Info ── */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Personal Info</p>
      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPerson size={13} className="text-gray-400" /> Full Name
          </label>
          {isPatient ? (
            <div className="space-y-1">
              <div className="input bg-gray-50 text-gray-600 cursor-not-allowed flex items-center justify-between">
                <span>{user?.name}</span>
                <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Locked</span>
              </div>
              <p className="text-xs text-gray-400">To correct your name, visit CRMC Medical Social Services.</p>
            </div>
          ) : (
            <input className="input" value={form.name} onChange={set('name')} placeholder="Your full name" />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPhone size={13} className="text-gray-400" /> Contact Number
          </label>
          <input className="input" value={form.contact} onChange={set('contact')} placeholder="09XXXXXXXXX" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdHome size={13} className="text-gray-400" />
            {isPatient ? 'Home Address' : 'Office Address'}
            {!isPatient && <span className="text-xs text-gray-400 font-normal ml-1">(optional)</span>}
          </label>
          <input className="input" value={form.address} onChange={set('address')}
            placeholder={isPatient ? 'Barangay, City, Province' : 'Office or work address (optional)'} />
          {isPatient && (
            <p className="text-xs text-gray-400 mt-0.5">Appears on your Guarantee Letter.</p>
          )}
        </div>
      </div>

      {/* ── Account Info ── */}
      <div className="border-t border-gray-100 mb-4" />
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">Account Info</p>
      <div className="space-y-3">
        {/* Role — shown for all non-patient roles, plus a quiet "Patient" badge for patients */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPerson size={13} className="text-gray-400" /> Role
          </label>
          <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed">
            <span>{ROLE_LABEL[user?.role] || user?.role?.replace('_', ' ')}</span>
            <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Locked</span>
          </div>
        </div>

        {/* Agency — for agency coordinators */}
        {isAgency && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <MdCheckCircle size={13} className="text-gray-400" /> Agency
            </label>
            <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed">
              <span>{agencyName || (user?.agencyId ? 'Loading…' : 'Not linked')}</span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">Locked</span>
            </div>
          </div>
        )}

        {/* Access Code — patients only */}
        {user?.hospitalId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <MdCheckCircle size={13} className="text-gray-400" /> Access Code
            </label>
            <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed font-mono">
              <span>{user.hospitalId}</span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-sans">Locked</span>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdEmail size={13} className="text-gray-400" /> Email Address
          </label>
          <div className="input bg-gray-50 text-gray-500 flex items-center justify-between cursor-not-allowed gap-2">
            <span className="truncate min-w-0 flex-1">{user?.email}</span>
            <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">Locked</span>
          </div>
          {!isPatient && (
            <p className="text-xs text-gray-400 mt-0.5">To change your email, contact the system administrator.</p>
          )}
        </div>
      </div>
    </ModalCard>
  )
}

// ── Change Password ───────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }) {
  const { user } = useAuth()
  const [form, setForm]     = useState({ current: '', newPw: '', confirm: '' })
  const [show, setShow]     = useState({ current: false, newPw: false, confirm: false })
  const [saving, setSaving] = useState(false)

  const set    = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  const toggle = (field) => setShow(prev => ({ ...prev, [field]: !prev[field] }))

  const strength = (pw) => {
    if (!pw) return null
    if (pw.length < 8) return { label: 'Too short', color: 'bg-red-400', w: 'w-1/3' }
    if (!/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
      return { label: 'Weak', color: 'bg-amber-400', w: 'w-2/3' }
    return { label: 'Strong', color: 'bg-green-500', w: 'w-full' }
  }
  const s = strength(form.newPw)

  const handleSave = async () => {
    if (!form.current)               { toast.error('Enter your current password.'); return }
    if (form.newPw.length < 8)       { toast.error('New password must be at least 8 characters.'); return }
    if (!/[A-Z]/.test(form.newPw))   { toast.error('Password must include an uppercase letter.'); return }
    if (!/[0-9]/.test(form.newPw))   { toast.error('Password must include a number.'); return }
    if (form.newPw === form.current) { toast.error('New password must be different from your current password.'); return }
    if (form.newPw !== form.confirm) { toast.error('Passwords do not match.'); return }
    setSaving(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, form.current)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, form.newPw)
      toast.success('Password changed successfully.')
      onClose()
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        toast.error('Current password is incorrect.')
      else toast.error(err.message || 'Failed to change password.')
    } finally {
      setSaving(false)
    }
  }

  // Inlined to avoid recreating the component on every render, which would
  // unmount the inputs each keystroke and steal focus from the user.
  const renderField = (label, field) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show[field] ? 'text' : 'password'}
          className="input pr-10"
          value={form[field]}
          onChange={set(field)}
          placeholder="••••••••"
          autoComplete={field === 'current' ? 'current-password' : 'new-password'}
        />
        <button type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
          onClick={() => toggle(field)}>
          {show[field] ? <MdVisibilityOff size={18} /> : <MdVisibility size={18} />}
        </button>
      </div>
    </div>
  )

  return (
    <ModalCard title="Change Password" onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Change Password'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
          <MdLock size={14} className="inline mr-1" />
          You'll need to enter your current password to make changes.
        </div>
        {renderField('Current Password', 'current')}
        <div>
          {renderField('New Password', 'newPw')}
          <p className="text-xs text-gray-400 mt-1">
            At least 8 characters, with one uppercase letter and one number.
          </p>
          {s && (
            <div className="mt-1.5">
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${s.color} ${s.w}`} />
              </div>
              <p className={`text-xs mt-0.5 font-medium ${
                s.label === 'Too short' ? 'text-red-500'
                : s.label === 'Weak'    ? 'text-amber-500'
                : 'text-green-600'
              }`}>{s.label}</p>
            </div>
          )}
        </div>
        {renderField('Confirm New Password', 'confirm')}
      </div>
    </ModalCard>
  )
}

// ── Privacy Notice ────────────────────────────────────────────────────────

const PRIVACY_SECTIONS = [
  {
    title: 'Data We Collect',
    items: [
      'Full name, email address, and contact number',
      'CRMC Patient Access Code and patient ID number',
      'Documents uploaded for verification (stored securely)',
      'Application submissions and their complete status history',
      'Messages exchanged with administrators and agency staff',
      'System activity logs for audit and compliance purposes',
    ],
  },
  {
    title: 'How Your Data is Used',
    items: [
      'To process and track your medical assistance applications',
      'To verify your eligibility for assistance programs',
      'To communicate with you about application updates and interview schedules',
      'To generate official Guarantee Letters for approved assistance',
      'To comply with government record-keeping regulations',
    ],
  },
  {
    title: 'Who Has Access',
    items: [
      'You — access to your own data only',
      'Agency Coordinators — applications submitted to their assigned agency',
      'Staff Administrators — documents and applications for review purposes',
      'System Administrators — full access for system management and audit',
    ],
  },
  {
    title: 'Data Retention',
    items: [
      'Your data is retained for the duration of your enrollment with CRMC.',
      'Records are kept as required by applicable government regulations.',
      'For data concerns or deletion requests, contact CRMC Medical Social Services.',
    ],
  },
]

function SettingsModal({ onClose }) {
  return (
    <ModalCard title="Privacy Notice" onClose={onClose}
      footer={<button className="btn-secondary text-sm" onClick={onClose}>Close</button>}>
      <div className="space-y-5">

        {/* Intro */}
        <div>
          <p className="text-sm text-gray-500 mb-1">
            This notice explains what information MAPA collects, how it is used, and who
            can access it. MAPA is operated by Cotabato Regional Medical Center (CRMC)
            in compliance with <strong className="text-gray-700">Republic Act 10173</strong> — the Data Privacy Act of 2012.
          </p>
          <p className="text-xs text-gray-400">Last updated: May 2026</p>
        </div>

        {/* Sections */}
        {PRIVACY_SECTIONS.map((section, i) => (
          <div key={i}>
            <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
              {section.title}
            </p>
            <ul className="space-y-1.5">
              {section.items.map((item, j) => (
                <li key={j} className="flex items-start gap-2 text-sm text-gray-600">
                  <span className="text-brand-400 flex-shrink-0 mt-0.5">•</span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        ))}

        {/* Patient rights — RA 10173 Section 16 */}
        <div>
          <p className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">
            Your Rights Under RA 10173
          </p>
          <ul className="space-y-1.5">
            {[
              'Right to be informed — know what data is collected and why.',
              'Right to access — request a copy of your personal data held by CRMC.',
              'Right to correction — have inaccurate or incomplete data corrected.',
              'Right to object — object to the processing of your data.',
              'Right to erasure — request deletion of your data subject to legal retention requirements.',
              'Right to file a complaint — lodge a complaint with the National Privacy Commission (privacy.gov.ph).',
            ].map((right, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="text-brand-400 flex-shrink-0 mt-0.5">•</span>
                {right}
              </li>
            ))}
          </ul>
        </div>

        {/* Contact */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <p className="text-sm text-blue-700">
            For questions about your data or to exercise your rights, contact{' '}
            <strong>CRMC Medical Social Services</strong> or email{' '}
            <strong>mss@crmc.gov.ph</strong>.
          </p>
        </div>

      </div>
    </ModalCard>
  )
}

// ── Help & Support ────────────────────────────────────────────────────────

const PATIENT_FAQS = [
  { q: 'How do I apply for medical assistance?',      a: 'From your dashboard, choose an agency and click "Apply". Fill in the intake sheet, upload the requested documents, and submit. You\'ll be notified when an agency picks up your application for review.' },
  { q: 'Where do I get a Patient Access Code?',       a: 'Patient Access Codes are issued in person by CRMC Medical Social Services. Bring a valid ID. The code follows the format CRMC-YYYY-NNNNN.' },
  { q: 'What is a Guarantee Letter?',                 a: 'A Guarantee Letter (GL) is the official document you receive when your application is approved. Present it at the provider to claim the approved assistance. GLs are valid for 30 days from issue.' },
  { q: 'How will I know if my application is approved?', a: 'You\'ll receive an in-app notification and email at each step — review, interview scheduling, and the final decision. Check the Dashboard and Notifications pages regularly.' },
  { q: 'How do I join my online interview?',          a: 'Once an interview is scheduled, a Google Meet link appears on your Dashboard. Click the link a few minutes before your slot — no install needed if you\'re on a recent browser.' },
  { q: 'Can I apply to more than one agency at the same time?', a: 'You may have one active application per assistance type. After an approval, there is a 30-day cooldown before you can apply again for the same type.' },
  { q: 'How do I withdraw an application?',           a: 'Open the application from your Dashboard and click "Withdraw". You can only withdraw while it is still pending — once a coordinator picks it up, contact them via Messages.' },
]

const AGENCY_FAQS = [
  { q: 'How do I review a new application?',          a: 'Open the Inbox — pending applications appear at the top. Click one to open the intake sheet, review documents, and either request changes, schedule an interview, or move it to approval.' },
  { q: 'How do I schedule an online interview?',      a: 'From an application in the review or interview stage, click "Schedule Interview", paste a Google Meet link, and pick a date/time. The patient is notified by email and in-app.' },
  { q: 'How do I issue a Guarantee Letter?',          a: 'On an approved application, open GL Letters and click "Issue GL". Fill in the amount and any notes; the system generates a printable letter and decrements your committed budget.' },
  { q: 'How do I mark a Guarantee Letter as redeemed?', a: 'Open GL Letters, find the issued GL, and click "Mark as Redeemed" after the patient claims it at the provider. Optionally attach the signed scan. This moves the amount from committed to disbursed.' },
  { q: 'Why can\'t I approve this application?',      a: 'The patient may already have an approval for the same assistance type within the last 30 days (cooldown), or your remaining budget is below the requested amount. Check the warning banner for the specific reason.' },
  { q: 'Where do I see my agency\'s budget?',         a: 'Your Dashboard shows the current period\'s budget, committed amount (issued GLs), and disbursed amount (redeemed GLs). For period changes, contact a staff administrator.' },
  { q: 'How do patients message me?',                 a: 'Open Messages — every conversation is linked to an application. Replies notify the patient by email and in-app.' },
]

const ADMIN_FAQS = [
  { q: 'How do I verify a patient document?',         a: 'Go to Doc Review under Operations. Click Verify or Reject on each pending document.' },
  { q: 'How do I issue a Patient Access Code?',       a: 'Navigate to Patient Access Codes and click "Add One" or "Bulk Add". The system auto-generates the next sequential code to issue to the patient.' },
  { q: 'How do I disable an agency?',                 a: 'Go to Agencies and click "Disable" on the agency card. This hides them from patients temporarily without deleting their data.' },
  { q: 'Where can I see all patient applications?',   a: 'Go to App Logs under Operations to view all submissions across agencies, with filters by status, agency, and date range.' },
  { q: 'How do I add a new admin account?',           a: 'Contact a super administrator to provision new admin accounts. Account creation is restricted to authorized personnel only.' },
  { q: 'How do I top up an agency\'s budget?',        a: 'Go to Funds, open the agency\'s ledger, and add a period entry. Each top-up is recorded in the audit log.' },
  { q: 'Where do I see audit history?',               a: 'Open Audit Log under Operations. Every admin action — verifications, account changes, budget edits — is recorded with the actor, target, and timestamp.' },
]

function HelpModal({ onClose, onOpenReport }) {
  const { user } = useAuth()
  const [open, setOpen] = useState(null)

  const role = user?.role
  const FAQS = role === 'patient' ? PATIENT_FAQS
             : (role === 'agency' || role === 'agency_admin') ? AGENCY_FAQS
             : ADMIN_FAQS
  const portalLabel = role === 'patient' ? 'patient portal'
                    : (role === 'agency' || role === 'agency_admin') ? 'agency portal'
                    : 'admin portal'

  const handleEmailSupport = () => {
    window.location.href = [
      'mailto:support@crmc.gov.ph',
      '?subject=MAPA Portal Support Request',
      '&body=Please describe your issue below:%0A%0A',
    ].join('')
  }

  return (
    <ModalCard title="Help & Support" onClose={onClose}
      footer={<button className="btn-secondary text-sm" onClick={onClose}>Close</button>}>

      <p className="text-xs text-gray-500 mb-4">Frequently asked questions about the MAPA {portalLabel}.</p>

      {/* FAQ list */}
      <div className="space-y-2 mb-5">
        {FAQS.map((faq, i) => (
          <div key={i} className="border border-gray-100 rounded-xl overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50 transition-colors"
              onClick={() => setOpen(open === i ? null : i)}>
              <span className="text-sm font-medium text-gray-800">{faq.q}</span>
              <span className="text-gray-400 text-lg flex-shrink-0 ml-2">{open === i ? '−' : '+'}</span>
            </button>
            {open === i && (
              <div className="px-4 pb-3 text-sm text-gray-500 leading-relaxed border-t border-gray-50">{faq.a}</div>
            )}
          </div>
        ))}
      </div>

      {/* Contact support section */}
      <div className="border-t border-gray-100 pt-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">Still need help?</p>

        {/* Email support */}
        <button
          onClick={handleEmailSupport}
          className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left mb-2"
        >
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0 text-base">
            📧
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">Email Support</p>
            <p className="text-xs text-gray-400">support@crmc.gov.ph</p>
          </div>
          <span className="text-xs text-blue-500 font-medium flex-shrink-0">Open →</span>
        </button>

        {/* Report in-app */}
        <button
          onClick={() => { onClose(); onOpenReport() }}
          className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0 text-base">
            🚩
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">Submit a Ticket</p>
            <p className="text-xs text-gray-400">Report directly inside the portal</p>
          </div>
          <span className="text-xs text-amber-500 font-medium flex-shrink-0">Open →</span>
        </button>
      </div>
    </ModalCard>
  )
}

// ── Report a Problem ──────────────────────────────────────────────────────

const PATIENT_CATEGORIES = [
  'Something isn\'t working',
  'My application has a problem',
  'My documents have a problem',
  'Something looks wrong',
  'I can\'t find what I\'m looking for',
  'Other',
]

const ADMIN_CATEGORIES = ['Bug / Error', 'UI Issue', 'Data Problem', 'Performance', 'Feature Request', 'Other']

function ReportModal({ onClose }) {
  const { user } = useAuth()
  const isPatient = user?.role === 'patient'
  const CATEGORIES = isPatient ? PATIENT_CATEGORIES : ADMIN_CATEGORIES
  const [form, setForm]       = useState({ category: '', description: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)

  const handleSend = async () => {
    if (!form.category)          { toast.error('Please select a category.'); return }
    if (!form.description.trim()){ toast.error('Please describe the problem.'); return }
    setSending(true)
    try {
      await addDoc(collection(db, 'reports'), {
        category:      form.category,
        description:   form.description.trim(),
        reportedBy:    user?.uid,
        reporterName:  user?.name,
        reporterEmail: user?.email,
        reporterRole:  user?.role,
        createdAt:     serverTimestamp(),
        status:        'open',
      })
      setSent(true)

      // Notify admins — fire and forget
      getDocs(query(collection(db, 'users'), where('role', 'in', ['super_admin', 'staff_admin'])))
        .then(snap => Promise.all(snap.docs.map(d => notify(d.id, {
          type:  'report_submitted',
          title: 'New problem report',
          body:  `${user?.name} reported: "${form.category}" — ${form.description.trim().slice(0, 80)}${form.description.trim().length > 80 ? '…' : ''}`,
        })))).catch(() => {})

    } catch {
      toast.error('Failed to submit report.')
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <ModalCard title="Report a Problem" onClose={onClose}
      footer={<button className="btn-primary text-sm" onClick={onClose}>Done</button>}>
      <div className="py-6 text-center">
        <MdCheckCircle size={48} className="text-green-500 mx-auto mb-3" />
        <p className="text-base font-semibold text-gray-800 mb-1">Report Submitted</p>
        <p className="text-sm text-gray-500">Thank you! Your report has been recorded and will be reviewed shortly.</p>
      </div>
    </ModalCard>
  )

  return (
    <ModalCard title="Report a Problem" onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary text-sm" onClick={handleSend} disabled={sending}>
            {sending ? 'Submitting...' : 'Submit Report'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Category <span className="text-red-400">*</span></label>
          <select className="input" value={form.category}
            onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}>
            <option value="">Select a category...</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description <span className="text-red-400">*</span></label>
          <textarea className="input resize-none" rows={4}
            placeholder={isPatient
              ? 'What happened? What were you trying to do when the problem occurred?'
              : 'Describe the problem in detail...'}
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
        </div>
        <p className="text-xs text-gray-400">Submitted as: {user?.name} ({user?.email})</p>
      </div>
    </ModalCard>
  )
}

// ── Main export ───────────────────────────────────────────────────────────

export default function ProfileModals({ activeModal, onClose, onSetModal }) {
  if (!activeModal) return null
  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {activeModal === 'account'  && <AccountSettingsModal onClose={onClose} />}
      {activeModal === 'password' && <ChangePasswordModal  onClose={onClose} />}
      {activeModal === 'settings' && <SettingsModal        onClose={onClose} />}
      {activeModal === 'help'     && <HelpModal            onClose={onClose} onOpenReport={() => onSetModal('report')} />}
      {activeModal === 'report'   && <ReportModal          onClose={onClose} />}
    </div>
  )
}
