import { displayEmail, isMaskedEmail } from '../../utils/maskEmail'

// An email link that respects masking (src/utils/maskEmail.js): a masked
// address shows masked and has no mailto in the page — the mail app opens
// with it only when tapped. Other addresses are ordinary mailto links.
// `children` replaces the shown text (e.g. "Email the office").
export default function EmailLink({ email, subject, body, className = '', children, ...rest }) {
  if (!email) return null
  const params = new URLSearchParams()
  if (subject) params.set('subject', subject)
  if (body) params.set('body', body)
  const query = params.toString() ? `?${params.toString().replace(/\+/g, '%20')}` : ''
  const label = children ?? displayEmail(email)
  if (!isMaskedEmail(email)) {
    return <a href={`mailto:${email}${query}`} className={className} {...rest}>{label}</a>
  }
  return (
    <a href="#" role="link" className={className} {...rest}
      onClick={(e) => { e.preventDefault(); window.location.href = `mailto:${email}${query}` }}>
      {label}
    </a>
  )
}
