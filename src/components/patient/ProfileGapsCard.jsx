import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { doc, updateDoc } from 'firebase/firestore'
import toast from 'react-hot-toast'
import { db } from '../../firebase'
import { useAuth } from '../../contexts/AuthContext'

// Phase 3B (2026-11-16): the DOH monthly assistance report needs each
// patient's age and sex. Accounts made before sign-up asked for them get this
// card once; each answer can be filled in once (firestore.rules), after which
// only hospital staff can correct it.
export default function ProfileGapsCard() {
  const { t } = useTranslation()
  const { user, updateUser } = useAuth()
  const [birthdate, setBirthdate] = useState('')
  const [sex, setSex] = useState('')
  const [saving, setSaving] = useState(false)
  if (user?.role !== 'patient') return null
  const needBirth = !user.birthdate
  const needSex = !user.sex
  if (!needBirth && !needSex) return null

  const today = new Date().toISOString().slice(0, 10)
  const ok = (!needBirth || (/^\d{4}-\d{2}-\d{2}$/.test(birthdate) && birthdate <= today)) &&
    (!needSex || ['female', 'male'].includes(sex))

  const save = async () => {
    if (!ok || saving) return
    setSaving(true)
    const fields = { ...(needBirth ? { birthdate } : {}), ...(needSex ? { sex } : {}) }
    try {
      await updateDoc(doc(db, 'users', user.uid), fields)
      updateUser?.(fields)
      toast.success(t('patient.profileGaps.saved'))
    } catch (err) {
      console.error('[ProfileGapsCard] save failed:', err)
      toast.error(t('patient.profileGaps.failed'))
    } finally { setSaving(false) }
  }

  return (
    <div className="card p-4 sm:p-5 border-l-4 border-brand-500 space-y-3">
      <div>
        <p className="text-sm font-semibold text-gray-900">{t('patient.profileGaps.title')}</p>
        <p className="text-xs text-gray-500 mt-0.5">{t('patient.profileGaps.desc')}</p>
      </div>
      {needBirth && (
        <div>
          <label htmlFor="gap-birth" className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.birthdate')}</label>
          <input id="gap-birth" type="date" className="input" max={today} value={birthdate} onChange={e => setBirthdate(e.target.value)} />
        </div>
      )}
      {needSex && (
        <fieldset>
          <legend className="block text-xs font-medium text-gray-700 mb-1">{t('register.step1.sex')}</legend>
          <div className="flex gap-2">
            {['female', 'male'].map(v => (
              <label key={v} className={`flex-1 flex items-center gap-2 rounded-xl border px-3 min-h-[44px] cursor-pointer ${sex === v ? 'border-brand-500 bg-brand-50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" name="gap-sex" className="w-4 h-4 accent-brand-500" value={v} checked={sex === v} onChange={e => setSex(e.target.value)} />
                <span className="text-sm text-gray-800">{t(`register.step1.sex_${v}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <p className="text-[11px] text-gray-500">{t('patient.profileGaps.once')}</p>
      <button type="button" className="btn-primary w-full min-h-[44px] text-sm" disabled={!ok || saving} onClick={save}>
        {saving ? t('patient.profileGaps.saving') : t('patient.profileGaps.save')}
      </button>
    </div>
  )
}
