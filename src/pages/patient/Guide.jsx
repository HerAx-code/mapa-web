import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { useTranslation } from 'react-i18next'
import {
  MdExpandMore, MdExpandLess, MdCheckCircle,
  MdInfo, MdPerson, MdPersonAdd, MdUpload, MdAssignment,
  MdUndo, MdTimeline, MdVideoCall, MdDownload, MdMessage, MdLock,
  MdSearch, MdClose, MdGroups, MdFactCheck,
} from 'react-icons/md'

function Section({ icon: Icon, title, content, steps, items, note, link, forceOpen }) {
  const [open, setOpen]   = useState(false)
  const navigate          = useNavigate()
  // Search mode overrides the per-section toggle so every matching
  // section reveals its body at once -- patients searching "interview"
  // expect to see the answer, not still need to tap.
  const isOpen = forceOpen || open
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
        disabled={forceOpen}>
        <div className="flex items-center gap-3">
          {Icon && <Icon size={18} className="text-brand-400 flex-shrink-0" />}
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        {isOpen ? <MdExpandLess size={20} className="text-gray-400 flex-shrink-0" />
                : <MdExpandMore size={20} className="text-gray-400 flex-shrink-0" />}
      </button>
      {isOpen && (
        <div className="px-5 pb-5 pt-1 bg-white border-t border-gray-50 space-y-3">
          {content && (
            <p className="text-sm text-gray-600 leading-relaxed">{content}</p>
          )}
          {steps && (
            <ol className="space-y-2">
              {steps.map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                    {i + 1}
                  </span>
                  <span className="text-sm text-gray-600">{step}</span>
                </li>
              ))}
            </ol>
          )}
          {items && (
            <div className="space-y-2">
              {items.map((item, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                  <MdCheckCircle size={16} className="text-brand-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{item.label}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          {note && (
            <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5">
              <p className="text-sm text-blue-700">{note}</p>
            </div>
          )}
          {link && (
            <button
              className="w-full py-2.5 rounded-xl border border-brand-200 text-sm font-medium text-brand-600 hover:bg-brand-50 transition-colors"
              onClick={() => navigate(link.path)}>
              {link.label} →
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function UserGuide() {
  const { t } = useTranslation()
  const [searchQuery, setSearchQuery] = useState('')

  // Section content sourced from i18n. Icons / link paths stay here as code
  // (not translatable). Build inside the component so t() is in scope and
  // re-renders on language change.
  const SECTIONS = [
    {
      icon:    MdInfo,
      title:   t('patient.guide.sections.whatIsMapa.title'),
      content: t('patient.guide.sections.whatIsMapa.content'),
    },
    {
      icon:    MdPerson,
      title:   t('patient.guide.sections.whoCanUse.title'),
      content: t('patient.guide.sections.whoCanUse.content'),
    },
    {
      icon:  MdPersonAdd,
      title: t('patient.guide.sections.register.title'),
      steps: [
        t('patient.guide.sections.register.s1'),
        t('patient.guide.sections.register.s2'),
        t('patient.guide.sections.register.s3'),
        t('patient.guide.sections.register.s4'),
        t('patient.guide.sections.register.s5'),
      ],
    },
    {
      icon:  MdUpload,
      title: t('patient.guide.sections.upload.title'),
      steps: [
        t('patient.guide.sections.upload.s1'),
        t('patient.guide.sections.upload.s2'),
        t('patient.guide.sections.upload.s3'),
        t('patient.guide.sections.upload.s4'),
        t('patient.guide.sections.upload.s5'),
        t('patient.guide.sections.upload.s6'),
      ],
      note: t('patient.guide.sections.upload.note'),
      link: { label: t('patient.nav.requestAssistance'), path: '/patient/request' },
    },
    {
      icon:  MdAssignment,
      title: t('patient.guide.sections.apply.title'),
      steps: [
        t('patient.guide.sections.apply.s1'),
        t('patient.guide.sections.apply.s2'),
        t('patient.guide.sections.apply.s3'),
        t('patient.guide.sections.apply.s4'),
        t('patient.guide.sections.apply.s5'),
        t('patient.guide.sections.apply.s6'),
        t('patient.guide.sections.apply.s7'),
      ],
      note: t('patient.guide.sections.apply.note'),
      link: { label: t('patient.nav.requestAssistance'), path: '/patient/request' },
    },
    {
      // Explains the CRMC-gateway co-funding model -- patients see
      // multiple agency cards on TrackStatus and need to know why one
      // bill produces multiple slices.
      icon:    MdGroups,
      title:   t('patient.guide.sections.cofunding.title'),
      content: t('patient.guide.sections.cofunding.content'),
      note:    t('patient.guide.sections.cofunding.note'),
      link:    { label: t('patient.guide.linkGoToStatus'), path: '/patient/status' },
    },
    {
      // The patient-filled portion of the Unified Intake Sheet. Auto-
      // saves every 2s. Required before CRMC can finalize their
      // assessment portion.
      icon:    MdFactCheck,
      title:   t('patient.guide.sections.intakeWizard.title'),
      content: t('patient.guide.sections.intakeWizard.content'),
      steps: [
        t('patient.guide.sections.intakeWizard.s1'),
        t('patient.guide.sections.intakeWizard.s2'),
        t('patient.guide.sections.intakeWizard.s3'),
        t('patient.guide.sections.intakeWizard.s4'),
        t('patient.guide.sections.intakeWizard.s5'),
      ],
      note: t('patient.guide.sections.intakeWizard.note'),
    },
    {
      icon:  MdUndo,
      title: t('patient.guide.sections.withdraw.title'),
      steps: [
        t('patient.guide.sections.withdraw.s1'),
        t('patient.guide.sections.withdraw.s2'),
        t('patient.guide.sections.withdraw.s3'),
        t('patient.guide.sections.withdraw.s4'),
        t('patient.guide.sections.withdraw.s5'),
      ],
      note: t('patient.guide.sections.withdraw.note'),
      link: { label: t('patient.guide.linkGoToStatus'), path: '/patient/status' },
    },
    {
      // Request-level stepper (the patient's overall journey toward
      // zero balance). Six stages shown on TrackStatus's main card.
      icon:    MdTimeline,
      title:   t('patient.guide.sections.requestLifecycle.title'),
      content: t('patient.guide.sections.requestLifecycle.content'),
      items: [
        { label: t('patient.guide.sections.requestLifecycle.submittedLabel'),       desc: t('patient.guide.sections.requestLifecycle.submittedDesc') },
        { label: t('patient.guide.sections.requestLifecycle.underReviewLabel'),     desc: t('patient.guide.sections.requestLifecycle.underReviewDesc') },
        { label: t('patient.guide.sections.requestLifecycle.assessmentLabel'),      desc: t('patient.guide.sections.requestLifecycle.assessmentDesc') },
        { label: t('patient.guide.sections.requestLifecycle.endorsedLabel'),        desc: t('patient.guide.sections.requestLifecycle.endorsedDesc') },
        { label: t('patient.guide.sections.requestLifecycle.partiallyFundedLabel'), desc: t('patient.guide.sections.requestLifecycle.partiallyFundedDesc') },
        { label: t('patient.guide.sections.requestLifecycle.fullyFundedLabel'),     desc: t('patient.guide.sections.requestLifecycle.fullyFundedDesc') },
      ],
      link: { label: t('patient.guide.linkGoToStatus'), path: '/patient/status' },
    },
    {
      // Per-agency slice stepper (each card under the main request
      // card on TrackStatus). Four stages, plus possible Rejected.
      icon:  MdAssignment,
      title: t('patient.guide.sections.statuses.title'),
      content: t('patient.guide.sections.statuses.content'),
      items: [
        { label: t('patient.guide.sections.statuses.endorsedLabel'),   desc: t('patient.guide.sections.statuses.endorsedDesc')   },
        { label: t('patient.guide.sections.statuses.reviewingLabel'),  desc: t('patient.guide.sections.statuses.reviewingDesc')  },
        { label: t('patient.guide.sections.statuses.awaitingInfoLabel'), desc: t('patient.guide.sections.statuses.awaitingInfoDesc') },
        { label: t('patient.guide.sections.statuses.approvedLabel'),   desc: t('patient.guide.sections.statuses.approvedDesc')   },
        { label: t('patient.guide.sections.statuses.certLabel'),       desc: t('patient.guide.sections.statuses.certDesc')       },
        { label: t('patient.guide.sections.statuses.rejectedLabel'),   desc: t('patient.guide.sections.statuses.rejectedDesc')   },
      ],
      link: { label: t('patient.guide.linkGoToStatus'), path: '/patient/status' },
    },
    {
      icon:  MdVideoCall,
      title: t('patient.guide.sections.interview.title'),
      steps: [
        t('patient.guide.sections.interview.s1'),
        t('patient.guide.sections.interview.s2'),
        t('patient.guide.sections.interview.s3'),
        t('patient.guide.sections.interview.s4'),
        t('patient.guide.sections.interview.s5'),
      ],
      note: t('patient.guide.sections.interview.note'),
      link: { label: t('patient.guide.linkGoToInterviews'), path: '/patient/interviews' },
    },
    {
      icon:  MdDownload,
      title: t('patient.guide.sections.download.title'),
      steps: [
        t('patient.guide.sections.download.s1'),
        t('patient.guide.sections.download.s2'),
        t('patient.guide.sections.download.s3'),
        t('patient.guide.sections.download.s4'),
        t('patient.guide.sections.download.s5'),
      ],
      note: t('patient.guide.sections.download.note'),
      link: { label: t('patient.guide.linkGoToStatus'), path: '/patient/status' },
    },
    {
      icon:    MdMessage,
      title:   t('patient.guide.sections.contact.title'),
      content: t('patient.guide.sections.contact.content'),
      link:    { label: t('patient.guide.linkGoToMessages'), path: '/patient/messages' },
    },
    {
      icon:    MdLock,
      title:   t('patient.guide.sections.forgotPw.title'),
      content: t('patient.guide.sections.forgotPw.content'),
    },
  ]

  return (
    <Layout breadcrumb={t('patient.guide.title')}>
      <div className="px-3 py-4 sm:p-6 mx-auto w-full max-w-[100vw] sm:max-w-3xl overflow-x-clip">

        {/* Header */}
        <div className="mb-6">
          <p className="eyebrow">{t('patient.guide.eyebrow')}</p>
          <h1 className="text-[26px] font-bold tracking-tight text-gray-900 mt-1">{t('patient.guide.title')}</h1>
          <p className="text-sm text-gray-500 mt-1">{t('patient.guide.subtitle')}</p>
        </div>

        {/* Search box -- patients searching 'interview' or 'withdraw'
            shouldn't have to scan 14 collapsed sections. When the box
            is non-empty, only matching sections render and they're
            force-expanded so the answer is visible at once. */}
        <div className="relative mb-3">
          <MdSearch size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={t('patient.guide.searchPlaceholder')}
            className="input pl-10 pr-10" />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear')}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-colors">
              <MdClose size={14} />
            </button>
          )}
        </div>

        {/* Accordion sections */}
        {!searchQuery && (
          <p className="text-sm text-gray-500 mb-3">{t('patient.guide.tapHint')}</p>
        )}
        {(() => {
          const q = searchQuery.trim().toLowerCase()
          // Section content lives in title / content / steps[] / items[*]
          // / note -- the filter checks all of them so a keyword anywhere
          // in the body still surfaces the section.
          const matches = q
            ? SECTIONS.filter(s => {
                const hay = [
                  s.title, s.content ?? '',
                  ...(s.steps ?? []),
                  ...(s.items ?? []).flatMap(it => [it.label, it.desc]),
                  s.note ?? '',
                ].filter(Boolean).join(' ').toLowerCase()
                return hay.includes(q)
              })
            : SECTIONS
          if (matches.length === 0) {
            return (
              <div className="card p-8 text-center">
                <p className="text-sm text-gray-500">{t('patient.guide.noResults', { query: searchQuery })}</p>
              </div>
            )
          }
          return (
            <div className="space-y-2">
              {matches.map((s, i) => <Section key={i} {...s} forceOpen={!!q} />)}
            </div>
          )
        })()}

        {/* Footer */}
        <div className="mt-6 card p-4 text-center">
          <p className="text-xs text-gray-500">{t('patient.guide.footer')}</p>
        </div>
      </div>
    </Layout>
  )
}