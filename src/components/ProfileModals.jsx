import { useState, useRef, useEffect } from 'react'
import { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp, getDocs, query, where } from 'firebase/firestore'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'
import { ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, auth, storage } from '../firebase'
import { notify } from '../utils/notifications'

// Phase 2.4: profile photos now live in Cloud Storage at
//   /profilePhotos/{uid}/avatar.jpg
// instead of inline base64 strings in users/{uid}.photoURL. Removes
// the 13%-of-1MiB doc bloat per user and lets us treat photos like
// real files (cache headers, CDN, etc.) for free.
//
// Resize to 200x200 client-side (same as the old base64 path) so
// upload bandwidth stays tiny on indigent-patient phones, then push
// the JPEG Blob to Storage and return the public download URL. The
// downloadURL goes into users/{uid}.photoURL exactly as before --
// every consumer of `user.photoURL` is shape-compatible.
const resizeToJpegBlob = (file) => new Promise((resolve, reject) => {
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
      const min = Math.min(img.width, img.height)
      const sx  = (img.width  - min) / 2
      const sy  = (img.height - min) / 2
      ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE)
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob returned null')), 'image/jpeg', 0.75)
    }
    img.src = e.target.result
  }
  reader.readAsDataURL(file)
})

const uploadProfilePhoto = async (uid, file) => {
  const blob = await resizeToJpegBlob(file)
  const path = `profilePhotos/${uid}/avatar.jpg`
  const ref  = storageRef(storage, path)
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' })
  return await getDownloadURL(ref)
}

const deleteProfilePhoto = async (uid) => {
  try {
    await deleteObject(storageRef(storage, `profilePhotos/${uid}/avatar.jpg`))
  } catch (e) {
    // Object-not-found is fine -- means the user never uploaded one,
    // or the existing photoURL was still in the legacy base64 form.
    if (e?.code !== 'storage/object-not-found') throw e
  }
}
import { useAuth } from '../contexts/AuthContext'
import { ROLE_LABEL } from '../utils/constants'
import { buildPatientDataExport, downloadAsJSON, patientExportFilename } from '../utils/dataExport'
import { useTranslation, Trans } from 'react-i18next'
import AddressPicker, { joinAddress } from './AddressPicker'
import {
  MdClose, MdVisibility, MdVisibilityOff, MdCameraAlt,
  MdPerson, MdLock, MdPhone, MdHome, MdEmail,
  MdCheckCircle, MdDelete, MdWarning, MdFlag,
} from 'react-icons/md'
import toast from 'react-hot-toast'

// ── Shared modal wrapper ──────────────────────────────────────────────────

function ModalCard({ title, onClose, children, footer }) {
  return (
    // Bottom-anchored on mobile, centered on sm+. Mobile users get
    // a native-feeling sheet that slides up from the bottom edge
    // within thumb reach; desktop / tablet users keep the classic
    // centered modal.
    <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-md max-h-[90vh] flex flex-col">
      {/* Drag handle — mobile only. Visual cue that this is a
          dismissible sheet, not a fixed page overlay. */}
      <div className="sm:hidden flex justify-center pt-3 pb-1 flex-shrink-0">
        <div className="w-10 h-1.5 bg-gray-300 rounded-full" />
      </div>
      <div className="flex items-center justify-between px-5 py-3 sm:py-4 border-b border-gray-100 flex-shrink-0">
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
  const { t }                = useTranslation()
  const fileRef = useRef(null)

  // Address is structured: barangay/city/province come from registration
  // (R39 patient flow). For pre-R39 users or staff who never had structured
  // address fields, they default to empty -- the picker just starts fresh.
  // The flat `address` string is rederived on save via joinAddress() so the
  // existing display surfaces (GL, intake sheet) keep working without
  // changes.
  const [form, setForm] = useState({
    name:     user?.name     ?? '',
    contact:  user?.contact  ?? '',
    barangay: user?.barangay ?? '',
    city:     user?.city     ?? '',
    province: user?.province ?? '',
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
  // banner is irrelevant for admin/agency. After R39 the address is
  // structured, so completeness means barangay/city/province all set.
  const isIncomplete = isPatient && !(
    form.barangay.trim() && form.city.trim() && form.province.trim()
  )

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
    if (!file.type.startsWith('image/')) { toast.error(t('profile.account.errImage')); return }
    if (file.size > 10 * 1024 * 1024)   { toast.error(t('profile.account.errPhotoSize')); return }
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
    if (!isPatient && !form.name.trim()) { toast.error(t('profile.account.errEmptyName')); return }
    setSaving(true)
    try {
      let photoURL = user?.photoURL ?? null

      if (!isPatient) {
        // Phase 2.4: upload to Storage instead of base64. Returns the
        // https download URL; existing readers of user.photoURL work
        // unchanged since both data: and https: render in <img>.
        if (photoFile)    photoURL = await uploadProfilePhoto(user.uid, photoFile)
        if (removePhoto) {
          await deleteProfilePhoto(user.uid)
          photoURL = null
        }
      }

      const updates = {
        contact:  form.contact.trim(),
        // R39: persist both the structured fields AND a derived flat
        // string so existing display surfaces (GL, intake sheet,
        // patient list) keep reading from `address` without changes.
        barangay: form.barangay.trim(),
        city:     form.city.trim(),
        province: form.province.trim(),
        address:  joinAddress({
          barangay: form.barangay,
          city:     form.city,
          province: form.province,
        }),
        photoURL,
      }
      if (!isPatient) updates.name = form.name.trim()

      await updateDoc(doc(db, 'users', user.uid), updates)
      updateUser({ ...updates, name: isPatient ? user.name : form.name.trim() })
      toast.success(t('profile.account.success'))
      onClose()
    } catch (err) {
      toast.error(t('profile.account.failed'))
      console.error(err)
    } finally {
      setSaving(false)
    }
  }

  const initials = form.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'

  return (
    <ModalCard
      title={t('profile.account.title')}
      onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>{t('profile.account.cancel')}</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? t('profile.account.saving') : t('profile.account.save')}
          </button>
        </>
      }
    >
      {/* Incomplete profile banner (patients only) */}
      {isIncomplete && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 mb-4 flex items-start gap-2">
          <MdWarning size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-700">
            {t('profile.account.incompleteAddress')}
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
              <MdCameraAlt size={13} /> {t('profile.account.changePhoto')}
            </button>
            {photoPreview && (
              <button
                onClick={handleRemovePhoto}
                className="text-xs text-red-500 font-medium border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors flex items-center gap-1"
              >
                <MdDelete size={13} /> {t('profile.account.removePhoto')}
              </button>
            )}
          </div>
        )}
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoChange} />
        {!isPatient && (
          <p className="text-xs text-gray-400 mt-1.5">{t('profile.account.photoHint')}</p>
        )}
      </div>

      <div className="border-t border-gray-100 mb-4" />

      {/* ── Personal Info ── */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{t('profile.account.personalInfo')}</p>
      <div className="space-y-3 mb-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPerson size={13} className="text-gray-400" /> {t('profile.account.fullName')}
          </label>
          {isPatient ? (
            <div className="space-y-1">
              <div className="input bg-gray-50 text-gray-600 cursor-not-allowed flex items-center justify-between">
                <span>{user?.name}</span>
                <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">{t('profile.account.lockedTag')}</span>
              </div>
              <p className="text-xs text-gray-400">{t('profile.account.nameLockedHint')}</p>
            </div>
          ) : (
            <input className="input" value={form.name} onChange={set('name')} placeholder={t('profile.account.fullNamePlaceholder')} />
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPhone size={13} className="text-gray-400" /> {t('profile.account.contactNumber')}
          </label>
          <input className="input" value={form.contact} onChange={set('contact')} placeholder={t('profile.account.contactPlaceholder')} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdHome size={13} className="text-gray-400" />
            {isPatient ? t('profile.account.homeAddress') : t('profile.account.officeAddress')}
            {!isPatient && <span className="text-xs text-gray-400 font-normal ml-1">{t('profile.account.addressOptional')}</span>}
          </label>
          {/* R39: cascading Province → City → Barangay dropdown with an
              "Other (not listed)" free-text fallback for addresses outside
              BARMM. Staff with offices outside the region (e.g. NCR) hit
              the fallback once and continue typing. */}
          <AddressPicker
            value={{ province: form.province, city: form.city, barangay: form.barangay }}
            onChange={({ province, city, barangay }) =>
              setForm(prev => ({ ...prev, province, city, barangay }))}
          />
          {isPatient && (
            <p className="text-xs text-gray-400 mt-1">{t('profile.account.addressGLHint')}</p>
          )}
        </div>
      </div>

      {/* ── Account Info ── */}
      <div className="border-t border-gray-100 mb-4" />
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">{t('profile.account.accountInfo')}</p>
      <div className="space-y-3">
        {/* Role — shown for all non-patient roles, plus a quiet "Patient" badge for patients */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdPerson size={13} className="text-gray-400" /> {t('profile.account.role')}
          </label>
          <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed">
            <span>{ROLE_LABEL[user?.role] || user?.role?.replace('_', ' ')}</span>
            <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">{t('profile.account.lockedTag')}</span>
          </div>
        </div>

        {/* Agency — for agency coordinators */}
        {isAgency && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <MdCheckCircle size={13} className="text-gray-400" /> {t('profile.account.agency')}
            </label>
            <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed">
              <span>{agencyName || (user?.agencyId ? t('profile.account.agencyLoading') : t('profile.account.agencyNotLinked'))}</span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full">{t('profile.account.lockedTag')}</span>
            </div>
          </div>
        )}

        {/* Access Code — patients only */}
        {user?.hospitalId && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
              <MdCheckCircle size={13} className="text-gray-400" /> {t('profile.account.accessCode')}
            </label>
            <div className="input bg-gray-50 text-gray-600 flex items-center justify-between cursor-not-allowed font-mono">
              <span>{user.hospitalId}</span>
              <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-sans">{t('profile.account.lockedTag')}</span>
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1">
            <MdEmail size={13} className="text-gray-400" /> {t('profile.account.emailAddress')}
          </label>
          <div className="input bg-gray-50 text-gray-500 flex items-center justify-between cursor-not-allowed gap-2">
            <span className="truncate min-w-0 flex-1">{user?.email}</span>
            <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full flex-shrink-0">{t('profile.account.lockedTag')}</span>
          </div>
          {!isPatient && (
            <p className="text-xs text-gray-400 mt-0.5">{t('profile.account.emailLockedHint')}</p>
          )}
        </div>
      </div>
    </ModalCard>
  )
}

// ── Change Password ───────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }) {
  const { user } = useAuth()
  const { t }    = useTranslation()
  const [form, setForm]     = useState({ current: '', newPw: '', confirm: '' })
  const [show, setShow]     = useState({ current: false, newPw: false, confirm: false })
  const [saving, setSaving] = useState(false)

  const set    = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }))
  const toggle = (field) => setShow(prev => ({ ...prev, [field]: !prev[field] }))

  const strength = (pw) => {
    if (!pw) return null
    if (pw.length < 8) return { key: 'tooShort', label: t('profile.password.strength.tooShort'), color: 'bg-red-400', w: 'w-1/3' }
    if (!/[A-Z]/.test(pw) || !/[0-9]/.test(pw))
      return { key: 'weak', label: t('profile.password.strength.weak'), color: 'bg-amber-400', w: 'w-2/3' }
    return { key: 'strong', label: t('profile.password.strength.strong'), color: 'bg-green-500', w: 'w-full' }
  }
  const s = strength(form.newPw)

  const handleSave = async () => {
    if (!form.current)               { toast.error(t('profile.password.errCurrent')); return }
    if (form.newPw.length < 8)       { toast.error(t('profile.password.errMin')); return }
    if (!/[A-Z]/.test(form.newPw))   { toast.error(t('profile.password.errUpper')); return }
    if (!/[0-9]/.test(form.newPw))   { toast.error(t('profile.password.errNumber')); return }
    if (form.newPw === form.current) { toast.error(t('profile.password.errSame')); return }
    if (form.newPw !== form.confirm) { toast.error(t('profile.password.errMismatch')); return }
    setSaving(true)
    try {
      const credential = EmailAuthProvider.credential(user.email, form.current)
      await reauthenticateWithCredential(auth.currentUser, credential)
      await updatePassword(auth.currentUser, form.newPw)
      toast.success(t('profile.password.success'))
      onClose()
    } catch (err) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential')
        toast.error(t('profile.password.errWrong'))
      else toast.error(err.message || t('profile.password.errFailed'))
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
    <ModalCard title={t('profile.password.title')} onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>{t('profile.password.cancel')}</button>
          <button className="btn-primary text-sm" onClick={handleSave} disabled={saving}>
            {saving ? t('profile.password.saving') : t('profile.password.save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-sm text-amber-700">
          <MdLock size={14} className="inline mr-1" />
          {t('profile.password.reauthNotice')}
        </div>
        {renderField(t('profile.password.current'), 'current')}
        <div>
          {renderField(t('profile.password.new'), 'newPw')}
          <p className="text-xs text-gray-400 mt-1">
            {t('profile.password.rules')}
          </p>
          {s && (
            <div className="mt-1.5">
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${s.color} ${s.w}`} />
              </div>
              <p className={`text-xs mt-0.5 font-medium ${
                s.key === 'tooShort' ? 'text-red-500'
                : s.key === 'weak'   ? 'text-amber-500'
                : 'text-green-600'
              }`}>{s.label}</p>
            </div>
          )}
        </div>
        {renderField(t('profile.password.confirm'), 'confirm')}
      </div>
    </ModalCard>
  )
}

// ── Privacy Notice ────────────────────────────────────────────────────────

function SettingsModal({ onClose }) {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [exporting, setExporting] = useState(false)

  const isPatient = user?.role === 'patient'

  const handleExport = async () => {
    if (!user?.uid || exporting) return
    setExporting(true)
    try {
      const data = await buildPatientDataExport(user.uid)
      downloadAsJSON(data, patientExportFilename(user.uid))
      // R6 (2026-06-03): the export now uses Promise.allSettled, so
      // some collections may have failed while others succeeded. Toast
      // differently when there are gaps so the patient knows the
      // download isn't complete -- the JSON's top-level `errors` array
      // has the specifics.
      if (data.errors && data.errors.length > 0) {
        toast(
          `Downloaded with ${data.errors.length} section${data.errors.length === 1 ? '' : 's'} unavailable. ` +
          'See the "errors" field in the file for details, or contact MSS.',
          { icon: <MdWarning className="text-amber-500" />, duration: 8000 },
        )
      } else {
        toast.success(t('profile.privacy.exportSuccess'))
      }
    } catch (err) {
      console.error('[dataExport] failed:', err)
      toast.error(t('profile.privacy.exportFailed'))
    } finally {
      setExporting(false)
    }
  }
  const sections = [
    { title: t('profile.privacy.dataTitle'), items: [t('profile.privacy.data1'), t('profile.privacy.data2'), t('profile.privacy.data3'), t('profile.privacy.data4'), t('profile.privacy.data5'), t('profile.privacy.data6')] },
    { title: t('profile.privacy.useTitle'),  items: [t('profile.privacy.use1'),  t('profile.privacy.use2'),  t('profile.privacy.use3'),  t('profile.privacy.use4'),  t('profile.privacy.use5')] },
    { title: t('profile.privacy.accessTitle'), items: [t('profile.privacy.access1'), t('profile.privacy.access2'), t('profile.privacy.access3'), t('profile.privacy.access4')] },
    { title: t('profile.privacy.retentionTitle'), items: [t('profile.privacy.retention1'), t('profile.privacy.retention2'), t('profile.privacy.retention3')] },
  ]
  const rights = [
    t('profile.privacy.right1'), t('profile.privacy.right2'), t('profile.privacy.right3'),
    t('profile.privacy.right4'), t('profile.privacy.right5'), t('profile.privacy.right6'),
  ]
  return (
    <ModalCard title={t('profile.privacy.title')} onClose={onClose}
      footer={<button className="btn-secondary text-sm" onClick={onClose}>{t('profile.privacy.close')}</button>}>
      <div className="space-y-5">

        {/* Intro */}
        <div>
          <p className="text-sm text-gray-500 mb-1">
            <Trans i18nKey="profile.privacy.intro" components={{ b: <strong className="text-gray-700" /> }} />
          </p>
          <p className="text-xs text-gray-400">{t('profile.privacy.updated')}</p>
        </div>

        {/* Sections */}
        {sections.map((section, i) => (
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
            {t('profile.privacy.rightsTitle')}
          </p>
          <ul className="space-y-1.5">
            {rights.map((right, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                <span className="text-brand-400 flex-shrink-0 mt-0.5">•</span>
                {right}
              </li>
            ))}
          </ul>
        </div>

        {/* Data portability — RA 10173 §16(f). Patient-only so a logged-in
            agency/admin doesn't accidentally try to "export their own data"
            which has different shape and meaning. */}
        {isPatient && (
          <div className="bg-brand-50 border border-brand-100 rounded-xl p-4">
            <p className="text-sm font-semibold text-brand-700 mb-1">
              {t('profile.privacy.exportTitle')}
            </p>
            <p className="text-xs text-brand-700/80 mb-3 leading-relaxed">
              {t('profile.privacy.exportDesc')}
            </p>
            <button
              className="btn-secondary text-sm w-full flex items-center justify-center gap-1.5"
              onClick={handleExport}
              disabled={exporting}>
              {exporting ? t('profile.privacy.exporting') : `↓ ${t('profile.privacy.exportButton')}`}
            </button>
          </div>
        )}

        {/* Contact */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
          <p className="text-sm text-blue-700">
            <Trans i18nKey="profile.privacy.contact" components={{ b: <strong /> }} />
          </p>
        </div>

      </div>
    </ModalCard>
  )
}

// ── Help & Support ────────────────────────────────────────────────────────

// PATIENT_FAQS are sourced from i18n (profile.help.patientFaqs).
// Staff/admin FAQs remain English-only — internal staff per CLAUDE.md.

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
  const { user }        = useAuth()
  const { t, i18n }     = useTranslation()
  const [open, setOpen] = useState(null)

  const role = user?.role
  // Patient FAQs come from i18n (returnObjects → array). Staff FAQs stay English.
  const patientFaqs = i18n.t('profile.help.patientFaqs', { returnObjects: true }) || []
  const FAQS = role === 'patient' ? patientFaqs
             : (role === 'agency' || role === 'agency_admin') ? AGENCY_FAQS
             : ADMIN_FAQS
  const portalLabel = role === 'patient' ? t('profile.help.portalPatient')
                    : (role === 'agency' || role === 'agency_admin') ? t('profile.help.portalAgency')
                    : t('profile.help.portalAdmin')

  const handleEmailSupport = () => {
    window.location.href = [
      'mailto:support@crmc.gov.ph',
      '?subject=MAPA Support Request',
      '&body=Please describe your issue below:%0A%0A',
    ].join('')
  }

  return (
    <ModalCard title={t('profile.help.title')} onClose={onClose}
      footer={<button className="btn-secondary text-sm" onClick={onClose}>{t('profile.help.close')}</button>}>

      <p className="text-xs text-gray-500 mb-4">{t('profile.help.intro', { portal: portalLabel })}</p>

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
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">{t('profile.help.stillNeedHelp')}</p>

        {/* Email support */}
        <button
          onClick={handleEmailSupport}
          className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left mb-2"
        >
          <div className="w-9 h-9 bg-blue-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <MdEmail className="text-blue-500" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">{t('profile.help.emailSupport')}</p>
            <p className="text-xs text-gray-400">support@crmc.gov.ph</p>
          </div>
          <span className="text-xs text-blue-500 font-medium flex-shrink-0">{t('profile.help.openLink')} →</span>
        </button>

        {/* Report in-app */}
        <button
          onClick={() => { onClose(); onOpenReport() }}
          className="w-full flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="w-9 h-9 bg-amber-50 rounded-xl flex items-center justify-center flex-shrink-0">
            <MdFlag className="text-amber-500" size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800">{t('profile.help.submitTicket')}</p>
            <p className="text-xs text-gray-400">{t('profile.help.submitTicketDesc')}</p>
          </div>
          <span className="text-xs text-amber-500 font-medium flex-shrink-0">{t('profile.help.openLink')} →</span>
        </button>
      </div>
    </ModalCard>
  )
}

// ── Report a Problem ──────────────────────────────────────────────────────

// PATIENT_CATEGORIES sourced from i18n. Staff categories stay English.
const ADMIN_CATEGORIES = ['Bug / Error', 'UI Issue', 'Data Problem', 'Performance', 'Feature Request', 'Other']

function ReportModal({ onClose }) {
  const { user }              = useAuth()
  const { t, i18n }           = useTranslation()
  const isPatient             = user?.role === 'patient'
  const patientCategories     = i18n.t('profile.report.patientCategories', { returnObjects: true }) || []
  const CATEGORIES            = isPatient ? patientCategories : ADMIN_CATEGORIES
  const [form, setForm]       = useState({ category: '', description: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent]       = useState(false)

  const handleSend = async () => {
    if (!form.category)          { toast.error(t('profile.report.errCategory')); return }
    if (!form.description.trim()){ toast.error(t('profile.report.errDescription')); return }
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
      toast.error(t('profile.report.errFailed'))
    } finally {
      setSending(false)
    }
  }

  if (sent) return (
    <ModalCard title={t('profile.report.title')} onClose={onClose}
      footer={<button className="btn-primary text-sm" onClick={onClose}>{t('profile.report.done')}</button>}>
      <div className="py-6 text-center">
        <MdCheckCircle size={48} className="text-green-500 mx-auto mb-3" />
        <p className="text-base font-semibold text-gray-800 mb-1">{t('profile.report.successTitle')}</p>
        <p className="text-sm text-gray-500">{t('profile.report.successDesc')}</p>
      </div>
    </ModalCard>
  )

  return (
    <ModalCard title={t('profile.report.title')} onClose={onClose}
      footer={
        <>
          <button className="btn-secondary text-sm" onClick={onClose}>{t('profile.report.cancel')}</button>
          <button className="btn-primary text-sm" onClick={handleSend} disabled={sending}>
            {sending ? t('profile.report.submitting') : t('profile.report.submit')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.report.categoryLabel')} <span className="text-red-400">*</span></label>
          <select className="input" value={form.category}
            onChange={e => setForm(prev => ({ ...prev, category: e.target.value }))}>
            <option value="">{t('profile.report.categoryPlaceholder')}</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t('profile.report.descriptionLabel')} <span className="text-red-400">*</span></label>
          <textarea className="input resize-none" rows={4}
            placeholder={isPatient
              ? t('profile.report.descriptionPatient')
              : t('profile.report.descriptionStaff')}
            value={form.description}
            onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))} />
        </div>
        <p className="text-xs text-gray-400">{t('profile.report.submittedAs', { name: user?.name, email: user?.email })}</p>
      </div>
    </ModalCard>
  )
}

// ── Main export ───────────────────────────────────────────────────────────

export default function ProfileModals({ activeModal, onClose, onSetModal }) {
  if (!activeModal) return null
  return (
    <div className="fixed inset-0 bg-black/50 z-[200] flex items-end sm:items-center justify-center sm:p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      {activeModal === 'account'  && <AccountSettingsModal onClose={onClose} />}
      {activeModal === 'password' && <ChangePasswordModal  onClose={onClose} />}
      {activeModal === 'settings' && <SettingsModal        onClose={onClose} />}
      {activeModal === 'help'     && <HelpModal            onClose={onClose} onOpenReport={() => onSetModal('report')} />}
      {activeModal === 'report'   && <ReportModal          onClose={onClose} />}
    </div>
  )
}
