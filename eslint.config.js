/**
 * ESLint config — Phase 3.2 narrow setup.
 *
 * Intentionally scoped to ONE concern: catching hardcoded JSX strings
 * on patient-facing surfaces so the bilingual claim in CLAUDE.md
 * (Filipino + English) holds. Not a general lint configuration —
 * adding more rules later is fine, but for now noise from unused
 * vars / hook deps / etc. would drown out the i18n signal.
 *
 * Run:
 *   npm run lint:i18n            (warns, exits 0)
 *   npm run lint:i18n:strict     (errors, exits 1 for CI)
 *
 * Scope:
 *   - Lints src/pages/patient/** and src/components/patient/** (the
 *     patient-facing surfaces -- this is where bilingual matters).
 *   - Lints src/components/Layout.jsx and components shared with
 *     patients via Layout.
 *   - SKIPS src/pages/{agency,admin}/** -- staff surfaces are
 *     English-only by design (web portal targets professional users
 *     per CLAUDE.md).
 *
 * Allowed-string allow-list: short technical tokens that aren't real
 * UI copy (e.g. "₱", "—", className tokens). i18next/no-literal-string
 * is too aggressive without these.
 */

import js from '@eslint/js'
import i18next from 'eslint-plugin-i18next'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

const ALLOWED_LITERALS = [
  // currency / typography
  '₱', '—', '–', '…', '·', '•',
  // common single-letter / symbol UI tokens
  '*', '+', '-', '/', '?', '!', ':', ',', '.', '(', ')',
  // numeric strings that show up as labels
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  // mathematical units commonly inline
  '%', '#',
  // empty
  '', ' ',
]

export default [
  js.configs.recommended,
  {
    files: [
      'src/pages/patient/**/*.{js,jsx}',
      'src/components/patient/**/*.{js,jsx}',
      // Layout + InstallNudge are patient-touching even though they live
      // at the top of components/. Add more shared surfaces here over time.
      'src/components/Layout.jsx',
      'src/components/InstallNudge.jsx',
      'src/components/InstallPrompt.jsx',
      'src/components/AnnouncementBanner.jsx',
      'src/components/AnnouncementFeedCard.jsx',
      'src/components/OfflineBanner.jsx',
    ],
    plugins: { i18next, react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: { react: { version: '18' } },
    rules: {
      // The whole point of this config -- catch raw JSX strings on
      // patient-facing surfaces. Set to 'warn' so the existing dev/
      // build workflow doesn't break; promote to 'error' once the
      // baseline count is at zero.
      'i18next/no-literal-string': 'warn',
      'react/jsx-uses-react': 'error',
      'react/jsx-uses-vars': 'error',
      // Quiet down the recommended rules that don't matter here.
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-prototype-builtins': 'off',
    },
    // Some files have pre-existing `// eslint-disable-next-line
    // react-hooks/exhaustive-deps` comments from before this ESLint
    // setup. We don't install eslint-plugin-react-hooks here (out of
    // scope for the i18n pass), so the disable comments themselves
    // trigger "rule not found" errors. Tell the linter to ignore
    // unknown rule definitions in disable comments.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
  },
]
