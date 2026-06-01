import { MdBuildCircle, MdWarning, MdInfo } from 'react-icons/md'

// Visual config per announcement type. Single source of truth used by:
//   - components/AnnouncementBanner (the live banner + form preview)
//   - pages/admin/Announcements (form pill buttons via pillActive/pillInact)
//   - pages/agency/Announcements (re-exports the form via admin)
//
// Previously colocated with the admin form, which created a circular
// import once Layout's live banner started pulling from the same map
// (Layout -> AnnouncementBanner -> admin/Announcements -> ...). Lifting
// the config out of any page file breaks the cycle.
export const TYPE_CONFIG = {
  maintenance: {
    label:      'Maintenance',
    icon:       MdBuildCircle,
    emoji:      '⚙️',
    bg:         'bg-amber-50',
    border:     'border-amber-200',
    badge:      'bg-amber-100 text-amber-700',
    iconColor:  'text-amber-600',
    pillActive: 'bg-amber-500 text-white',
    pillInact:  'bg-white text-amber-700 border border-amber-300',
  },
  warning: {
    label:      'Warning',
    icon:       MdWarning,
    emoji:      '⚠️',
    bg:         'bg-red-50',
    border:     'border-red-200',
    badge:      'bg-red-100 text-red-700',
    iconColor:  'text-red-600',
    pillActive: 'bg-red-500 text-white',
    pillInact:  'bg-white text-red-700 border border-red-300',
  },
  info: {
    label:      'Info',
    icon:       MdInfo,
    emoji:      'ℹ️',
    bg:         'bg-blue-50',
    border:     'border-blue-200',
    badge:      'bg-blue-100 text-blue-700',
    iconColor:  'text-blue-600',
    pillActive: 'bg-blue-500 text-white',
    pillInact:  'bg-white text-blue-700 border border-blue-300',
  },
}