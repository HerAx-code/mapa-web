import { useTranslation } from 'react-i18next'
import { MdLanguage } from 'react-icons/md'

// Compact bilingual toggle: EN ↔ FIL. Persists via localStorage.
export default function LanguageToggle({ className = '' }) {
  const { i18n } = useTranslation()
  const current  = i18n.language?.startsWith('fil') ? 'fil' : 'en'

  const toggle = () => {
    i18n.changeLanguage(current === 'en' ? 'fil' : 'en')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={current === 'en' ? 'Lumipat sa Filipino' : 'Switch to English'}
      className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors ${className}`}>
      <MdLanguage size={14} />
      <span>{current === 'en' ? 'EN' : 'FIL'}</span>
    </button>
  )
}
