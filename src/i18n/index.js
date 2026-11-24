// i18next configuration for MAPA.
// English (en) and Filipino (fil) translations for patient-facing strings.
// Per CLAUDE.md: patient-facing UI must be bilingual.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './locales/en.json'
// Filipino is loaded on demand (its own chunk): English is the default, the
// fallback and the staff language, so it stays in the main bundle; Filipino
// (~30 KB gzipped) is fetched only for patients who choose it — see
// ensureLanguage / setLanguage / i18nReady below.
import { ORG, accessCodeFormatHint, accessCodePrefixFor, onOrgChange } from '../config/org'
import { displayEmail } from '../utils/maskEmail'

const STORAGE_KEY = 'mapa.lang'

// Org-brand tokens injected into every t() call via interpolation, so the
// translation JSON stays deployment-agnostic ({{org}}, {{gateway}}, {{prefix}},
// {{codeFormat}}, {{contactEmail}}) and a reskin needs no string edits.
// {{facility}} is language-aware: a configured facility name is a proper noun
// used in both languages, but the generic default differs ("the hospital" vs
// "ospital") so Filipino copy doesn't read "sa the hospital". ORG_VARS IS the
// defaultVariables object i18next interpolates from (by reference), so updating
// ORG_VARS.facility on languageChanged live-swaps it for every subsequent t().
const facilityFor = (lng) => (lng === 'fil' ? ORG.facilityNameFil : ORG.facilityName)

const ORG_VARS = {
  org:          ORG.name,
  orgFull:      ORG.fullName,
  gateway:      ORG.gatewayName,
  facility:     ORG.facilityName, // set per-language just below
  prefix:       ORG.accessCodePrefix,
  codeFormat:   accessCodeFormatHint(),
  codeExample:  `${accessCodePrefixFor(new Date().getFullYear())}00001`,
  contactEmail: displayEmail(ORG.contactEmail), // masked if it is the network address (utils/maskEmail.js)
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

// Resolve the facility token for the starting language before init.
ORG_VARS.facility = facilityFor(savedLang ?? 'en')

i18n
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en } },
    lng:           savedLang ?? 'en',
    fallbackLng:  'en',
    interpolation: {
      escapeValue: false,        // React already escapes
      defaultVariables: ORG_VARS, // {{org}}, {{gateway}}, {{prefix}}, … everywhere
    },
  })

// Multi-hospital (Phase 1): the signed-in user's hospital is applied to ORG
// after this module has already built ORG_VARS, so re-sync the hospital-level
// tokens in place (same object i18next holds by reference).
onOrgChange(() => {
  ORG_VARS.gateway      = ORG.gatewayName
  ORG_VARS.contactEmail = displayEmail(ORG.contactEmail)
  ORG_VARS.facility     = facilityFor(i18n.language)
})

i18n.on('languageChanged', (lng) => {
  // Live-swap the facility default so {{facility}} localizes. This handler is
  // registered before any component's useTranslation listener, so the update
  // lands before react-i18next re-renders on the same event.
  ORG_VARS.facility = facilityFor(lng)
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, lng)
    }
  } catch { /* storage unavailable — language just won't persist across reloads */ }
})

// Load a language's strings if they aren't in the bundle yet (Filipino).
// Never throws: on failure the app keeps working in English.
export async function ensureLanguage(lng) {
  if (lng !== 'fil' || i18n.hasResourceBundle('fil', 'translation')) return true
  try {
    const mod = await import('./locales/fil.json')
    i18n.addResourceBundle('fil', 'translation', mod.default ?? mod, true, true)
    return true
  } catch (err) {
    console.warn('[i18n] could not load Filipino; staying in English', err)
    return false
  }
}

// Switch language, loading its strings first. Use this instead of
// i18n.changeLanguage() so Filipino is never shown half-loaded.
export async function setLanguage(lng) {
  const ok = await ensureLanguage(lng)
  return i18n.changeLanguage(ok ? lng : 'en')
}

// Resolves once the starting language is ready. main.jsx waits for it before
// the first render, so a patient who chose Filipino never sees English flash.
export const i18nReady = savedLang === 'fil' ? setLanguage('fil') : Promise.resolve()

export default i18n
