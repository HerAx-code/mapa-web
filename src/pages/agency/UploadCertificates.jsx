import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// Legacy route: Upload Signed Certificates is now merged into the unified
// Guarantee Letters page at /agency/generator. Redirect any direct hits.
export default function UploadCertificates() {
  const navigate = useNavigate()
  useEffect(() => { navigate('/agency/generator', { replace: true }) }, [navigate])
  return null
}
