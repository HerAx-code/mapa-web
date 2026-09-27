// Client-side image handling for the patient document upload pipeline.
//
// Patients photograph IDs, billing statements and medical certificates on
// low-end phones over weak connections. Two goals, in tension:
//   1. Keep the base64 payload under the Firestore doc cap (documentContents
//      holds the image inline on the Spark plan — see uploadDocument.js).
//   2. Keep the image legible enough that on-device OCR can read an ID and a
//      CRMC verifier can read a bill.
// So we downscale to a legible long-edge, then trade JPEG quality (not more
// resolution) to hit the byte target, only shrinking further if quality alone
// can't get there.

// Long edge to aim for. 1600px keeps small ID text readable for OCR; 1200 (the
// previous value) was borderline. Quality is what absorbs most of the size.
export const IMAGE_MAX_DIM = 1600

// Scale (w, h) so the longest edge is at most maxDim, preserving aspect ratio.
// Pure + exported so the sizing math is unit-tested without a DOM/canvas.
export function fitDimensions(width, height, maxDim = IMAGE_MAX_DIM) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  if (w <= 0 || h <= 0) return { width: w, height: h }
  if (w <= maxDim && h <= maxDim) return { width: w, height: h }
  return w >= h
    ? { width: maxDim, height: Math.round(h * maxDim / w) }
    : { width: Math.round(w * maxDim / h), height: maxDim }
}

// Compress an image File to a JPEG data URL under ~maxBytes (base64 inflates
// ~4/3, so the string budget is maxBytes*4/3). Rejects on a decode failure so
// a corrupt photo surfaces as an upload error the caller can report — it never
// hangs the submit (the previous implementation had no onerror handler).
export function compressImage(file, maxBytes) {
  const maxB64 = Math.floor((Number(maxBytes) || 650 * 1024) * 4 / 3)
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('IMAGE_DECODE_FAILED')) }
    img.onload = () => {
      URL.revokeObjectURL(url)
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('2d')
      let maxDim = IMAGE_MAX_DIM
      let dataUrl = ''
      // Up to 3 passes: shrink the long edge only if dropping quality to 0.4
      // still can't meet the byte budget (keeps text as legible as the cap allows).
      for (let attempt = 0; attempt < 3; attempt++) {
        const { width, height } = fitDimensions(img.width, img.height, maxDim)
        canvas.width = width
        canvas.height = height
        ctx.clearRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        let quality = 0.85
        dataUrl = canvas.toDataURL('image/jpeg', quality)
        while (dataUrl.length > maxB64 && quality > 0.4) {
          quality = Math.round((quality - 0.1) * 100) / 100
          dataUrl = canvas.toDataURL('image/jpeg', quality)
        }
        if (dataUrl.length <= maxB64) break
        maxDim = Math.round(maxDim * 0.8)
      }
      resolve(dataUrl)
    }
    img.src = url
  })
}
