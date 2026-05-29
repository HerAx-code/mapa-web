import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import { useTranslation } from 'react-i18next'
import {
  MdExpandMore, MdExpandLess, MdCheckCircle,
  MdInfo, MdPerson, MdPersonAdd, MdUpload, MdAssignment,
  MdUndo, MdTimeline, MdVideoCall, MdDownload, MdMessage, MdLock,
} from 'react-icons/md'

function Section({ icon: Icon, title, content, steps, items, note, link }) {
  const [open, setOpen]   = useState(false)
  const navigate          = useNavigate()
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}>
        <div className="flex items-center gap-3">
          {Icon && <Icon size={18} className="text-brand-400 flex-shrink-0" />}
          <span className="text-sm font-semibold text-gray-800">{title}</span>
        </div>
        {open ? <MdExpandLess size={20} className="text-gray-400 flex-shrink-0" />
               : <MdExpandMore size={20} className="text-gray-400 flex-shrink-0" />}
      </button>
      {open && (
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
      icon:  MdTimeline,
      title: t('patient.guide.sections.statuses.title'),
      items: [
        { label: t('patient.guide.sections.statuses.pendingLabel'),   desc: t('patient.guide.sections.statuses.pendingDesc')   },
        { label: t('patient.guide.sections.statuses.reviewingLabel'), desc: t('patient.guide.sections.statuses.reviewingDesc') },
        { label: t('patient.guide.sections.statuses.interviewLabel'), desc: t('patient.guide.sections.statuses.interviewDesc') },
        { label: t('patient.guide.sections.statuses.approvedLabel'),  desc: t('patient.guide.sections.statuses.approvedDesc')  },
        { label: t('patient.guide.sections.statuses.certLabel'),      desc: t('patient.guide.sections.statuses.certDesc')      },
        { label: t('patient.guide.sections.statuses.rejectedLabel'),  desc: t('patient.guide.sections.statuses.rejectedDesc')  },
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
          <h1 className="page-title">{t('patient.guide.title')}</h1>
          <p className="page-sub">{t('patient.guide.subtitle')}</p>
        </div>

        {/* Accordion sections */}
        <p className="text-sm text-gray-500 mb-3">{t('patient.guide.tapHint')}</p>
        <div className="space-y-2">
          {SECTIONS.map((s, i) => <Section key={i} {...s} />)}
        </div>

        {/* Footer */}
        <div className="mt-6 card p-4 text-center">
          <p className="text-xs text-gray-500">{t('patient.guide.footer')}</p>
        </div>
      </div>
    </Layout>
  )
}