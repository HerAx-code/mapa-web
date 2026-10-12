// i18next configuration for MAPA.
// English (en) and Filipino (fil) translations for patient-facing strings.
// Per CLAUDE.md: patient-facing UI must be bilingual.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
import fil from './locales/fil.json'
import { ORG, accessCodeFormatHint, accessCodePrefixFor } from '../config/org'

const STORAGE_KEY = 'mapa.lang'

// Org-brand tokens injected into every t() call via interpolation, so the
// translation JSON stays deployment-agnostic ({{org}}, {{gateway}}, {{prefix}},
// {{codeFormat}}, {{contactEmail}}) and a reskin needs no string edits.
const ORG_VARS = {
  org:          ORG.name,
  orgFull:      ORG.fullName,
  gateway:      ORG.gatewayName,
  facility:     ORG.facilityName,
  prefix:       ORG.accessCodePrefix,
  codeFormat:   accessCodeFormatHint(),
  codeExample:  `${accessCodePrefixFor(new Date().getFullYear())}00001`,
  contactEmail: ORG.contactEmail,
}

// Reading window.localStorage can throw a SecurityError when storage is
// blocked (sandboxed iframe, strict privacy policy). Guard it so a blocked
// storage never turns into a blank-screen boot failure — we just default the
// language.
let savedLang = null
try {
  if (typeof window !== 'undefined' && window.localStorage) {
    savedLang = window.localStorage.getItem(STORAGE_KEY)
  }
} catch { savedLang = null }

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fil: { translation: fil } },
    lng:           savedLang ?? 'en',
    fallbackLng:  'en',
    interpolation: {
      escapeValue: false,        // React already escapes
      defaultVariables: ORG_VARS, // {{org}}, {{gateway}}, {{prefix}}, … everywhere
    },
  })

i18n.on('languageChanged', (lng) => {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, lng)
    }
  } catch { /* storage unavailable — language just won't persist across reloads */ }
})

export default i18n
