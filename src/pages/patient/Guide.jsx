import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Layout from '../../components/Layout'
import {
  MdExpandMore, MdExpandLess, MdCheckCircle,
  MdInfo, MdPerson, MdPersonAdd, MdUpload, MdAssignment,
  MdUndo, MdTimeline, MdVideoCall, MdDownload, MdMessage, MdLock,
} from 'react-icons/md'

const SECTIONS = [
  {
    icon: MdInfo,
    title: 'What is MAPA?',
    content: `MAPA (Medical Assistance Portal Access) is the official online portal of Cotabato Regional Medical Center (CRMC) for processing medical assistance applications. It allows patients to apply for financial or material assistance from partner government agencies such as DSWD, PCSO, and the Malasakit Center — all in one place, without lining up at multiple offices.`,
  },
  {
    icon: MdPerson,
    title: 'Who can use MAPA?',
    content: `Any patient of CRMC who has been assessed by Medical Social Services can register and use MAPA. You will receive a Patient Access Code (format: CRMC-YYYY-XXXXX) from the CRMC Medical Social Services office. You must have this code to create an account.`,
  },
  {
    icon: MdPersonAdd,
    title: 'How do I register?',
    steps: [
      'Visit CRMC Medical Social Services to be assessed and receive your Patient Access Code.',
      'Go to the MAPA registration page and fill in your full name, email, contact number, and address.',
      'Enter your Patient Access Code and click Verify to confirm it.',
      'Create a secure password and submit the form.',
      'Your account is created. Log in with your email and password.',
    ],
  },
  {
    icon: MdUpload,
    title: 'How do I upload documents?',
    steps: [
      'Log in and go to My Documents from the sidebar.',
      'Click Upload Document and select the document type (e.g., Valid ID, Medical Certificate).',
      'Choose a clear photo or scan of the document from your device.',
      'Click Upload. Your document will be submitted for admin verification.',
      'Once verified, a green "Verified" badge will appear on the document.',
      'Verified documents are automatically attached to your applications.',
    ],
    note: 'Tip: Upload documents before applying. Some programs require verified documents before your application can proceed. When uploading a Valid ID, you will be asked to select the specific ID type (e.g., PhilSys National ID, Driver\'s License) — this helps the reviewer verify it faster.',
    link: { label: 'Go to My Documents', path: '/patient/documents' },
  },
  {
    icon: MdAssignment,
    title: 'How do I apply for a program?',
    steps: [
      'Go to Find Programs from the sidebar.',
      'Answer the screening questions to find programs that match your medical needs.',
      'Review your matched programs and check how many spots are available today.',
      'Click Apply Now on the program you want to apply for.',
      'Review the requirements checklist — verified documents will show a green check.',
      'Tick the declaration checkbox confirming your documents are genuine.',
      'Click Submit Application. You will receive a notification with your application ID.',
    ],
    note: 'Important: Only one application is allowed at a time. You must wait for your current application to be resolved before applying to another program. Spots are limited and reset daily at midnight.',
    link: { label: 'Go to Find Programs', path: '/patient/screening' },
  },
  {
    icon: MdUndo,
    title: 'Can I cancel or withdraw my application?',
    steps: [
      'Go to My Application from the sidebar.',
      'Find your active application under the In Progress tab.',
      'Scroll to the bottom of the application card.',
      'Tap Withdraw Application — a confirmation will appear.',
      'Tap Yes, Withdraw to confirm. The spot will be returned and you can apply again.',
    ],
    note: 'You can only withdraw while your application is in Pending Review status. Once the agency starts reviewing, withdrawal is no longer available.',
    link: { label: 'Go to My Application', path: '/patient/status' },
  },
  {
    icon: MdTimeline,
    title: 'What do the application statuses mean?',
    items: [
      { label: 'Pending Review',    desc: 'Your application was received and is waiting for the agency to start reviewing.' },
      { label: 'Under Review',      desc: 'The agency has opened your application and is currently evaluating it.' },
      { label: 'Interview Scheduled', desc: 'The agency has scheduled a video interview with you. Check your Interviews page for the date and Google Meet link.' },
      { label: 'Approved',           desc: 'Your application has been approved for a specific amount. The agency is preparing your Guarantee Letter.' },
      { label: 'GL Issued',          desc: 'Your Guarantee Letter has been issued. Once the agency uploads the signed scan, you can download it from My Application.' },
      { label: 'Rejected',          desc: 'Your application was not approved. A reason will be provided. You may apply again after addressing the issue.' },
    ],
    link: { label: 'Go to My Application', path: '/patient/status' },
  },
  {
    icon: MdVideoCall,
    title: 'How do I join my interview?',
    steps: [
      'Go to Interviews from the sidebar to see your scheduled interviews.',
      'Note the date, time, and Google Meet link for your interview.',
      'At the scheduled time, click the Join Meet button to enter the video call.',
      'Prepare your original documents in case the agency asks to see them on camera.',
      'After the interview, the agency will update your application status.',
    ],
    note: 'If you need to reschedule, contact the agency directly through the Messages feature.',
    link: { label: 'Go to My Interviews', path: '/patient/interviews' },
  },
  {
    icon: MdDownload,
    title: 'How do I download my Guarantee Letter?',
    steps: [
      'Go to My Application from the sidebar.',
      'Find your approved application — it shows a green panel with the approved amount, purpose, and the provider it is payable to.',
      'Wait until the agency uploads the wet-signed copy. You will receive an in-portal notification when it is ready.',
      'Click the thumbnail to view the signed Guarantee Letter, or click Download to save a copy to your device.',
      'Present the signed Guarantee Letter (printed or shown on your phone) at the provider named on it (hospital billing, pharmacy, etc.).',
    ],
    note: 'The Guarantee Letter is valid for 30 days from the date of issuance. The named provider may bill the agency directly for the guaranteed amount — you are not responsible for the guaranteed portion.',
    link: { label: 'Go to My Application', path: '/patient/status' },
  },
  {
    icon: MdMessage,
    title: 'How do I contact the admin or agency?',
    content: `Go to Messages from the sidebar to view all your conversations. Tap the New Message button at the top right to start a new conversation with hospital staff or your assigned agency. You can message them directly if you have questions about your application, documents, or need to reschedule an interview.`,
    link: { label: 'Go to Messages', path: '/patient/messages' },
  },
  {
    icon: MdLock,
    title: 'I forgot my password. What do I do?',
    content: `On the Login page, click "Forgot Password?" and enter your registered email address. A password reset link will be sent to your email. Click the link to set a new password. If you did not receive the email, check your spam or junk folder. For further help, contact CRMC Medical Social Services.`,
  },
]

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
  return (
    <Layout breadcrumb="User Guide">
      <div className="p-4 sm:p-6 max-w-2xl mx-auto">

        {/* Header */}
        <div className="mb-6">
          <h1 className="page-title">User Guide</h1>
          <p className="page-sub">Everything you need to know about using the MAPA portal.</p>
        </div>

        {/* Accordion sections */}
        <p className="text-sm text-gray-500 mb-3">Tap any question below to read the answer.</p>
        <div className="space-y-2">
          {SECTIONS.map((s, i) => <Section key={i} {...s} />)}
        </div>

        {/* Footer */}
        <div className="mt-6 card p-4 text-center">
          <p className="text-xs text-gray-500">
            Need further assistance? Visit the <strong>CRMC Records Office</strong> or
            send a message through the portal using the envelope icon in the top bar.
          </p>
        </div>
      </div>
    </Layout>
  )
}
