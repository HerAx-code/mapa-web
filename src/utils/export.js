/**
 * Export data as a CSV file download.
 * @param {string} filename - e.g. 'patients-2026-05-14.csv'
 * @param {Array<{label: string, getValue: (row) => any}>} columns
 * @param {Array<object>} data
 */
export const exportToCSV = (filename, columns, data) => {
  const escape = (val) => {
    const str = String(val ?? '—')
    return str.includes(',') || str.includes('"') || str.includes('\n')
      ? `"${str.replace(/"/g, '""')}"`
      : str
  }

  const headers = columns.map(c => escape(c.label)).join(',')
  const rows    = data.map(row => columns.map(c => escape(c.getValue(row))).join(','))
  const csv     = [headers, ...rows].join('\n')

  // BOM for Excel UTF-8 compatibility
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export const dateStamp = () => new Date().toISOString().slice(0, 10)

export const readableFileType = (mime) => {
  if (!mime) return '—'
  if (mime.includes('pdf'))        return 'PDF'
  if (mime.startsWith('image/png'))  return 'PNG Image'
  if (mime.match(/image\/jpe?g/))    return 'JPEG Image'
  if (mime.startsWith('image/'))     return 'Image'
  return mime.split('/').pop()?.toUpperCase() ?? mime
}

/**
 * Opens a print-optimised tab with the given data rendered as an HTML table.
 * The browser print dialog fires automatically on load.
 */
export const openPrintTab = (data, label, cols, generatedBy = 'Admin') => {
  const now   = new Date().toLocaleString('en-PH', { dateStyle: 'long', timeStyle: 'short' })
  const stamp = new Date().toISOString().slice(0, 10)

  const headerCells = cols.map(c => `<th>${c.label}</th>`).join('')
  const bodyRows    = data.map((row, i) => {
    const cells = cols.map(c => {
      const val = c.getValue(row) ?? '—'
      return `<td>${String(val).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</td>`
    }).join('')
    return `<tr style="${i % 2 === 0 ? '' : 'background:#f9fafb'}">${cells}</tr>`
  }).join('')

  const statusCounts = {}
  data.forEach(row => {
    const s = row.status ?? 'unknown'
    statusCounts[s] = (statusCounts[s] ?? 0) + 1
  })
  const statusSummary = Object.entries(statusCounts)
    .map(([s, n]) => `<span style="margin-right:20px"><strong>${n}</strong> ${s}</span>`)
    .join('')

  const safeJson = JSON.stringify(data.map((row, i) => {
    const obj = { '#': i + 1 }
    cols.forEach(c => { obj[c.label] = c.getValue(row) ?? '' })
    return obj
  })).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${label} — MAPA CRMC</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Arial,sans-serif;font-size:13px;color:#111827;background:#f3f4f6}
    .page{max-width:1100px;margin:0 auto;background:white;padding:32px}
    .header{display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #0F6E56;padding-bottom:16px;margin-bottom:20px}
    .header h1{font-size:18px;color:#0F6E56;margin-bottom:4px}
    .header p{font-size:12px;color:#6b7280}
    .meta{display:flex;gap:32px;margin-bottom:16px;padding:10px 14px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;font-size:12px;color:#374151}
    .actions{display:flex;gap:10px;margin-bottom:20px}
    .btn{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none}
    .btn-secondary{background:white;color:#374151;border:1px solid #d1d5db}
    table{width:100%;border-collapse:collapse;font-size:12px}
    thead tr{background:#0F6E56}
    th{color:white;text-align:left;padding:9px 10px;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
    td{padding:8px 10px;border-bottom:1px solid #e5e7eb;vertical-align:middle}
    .footer{margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;line-height:1.6}
    @media print{body{background:white}.actions{display:none!important}.page{padding:0;max-width:100%}thead tr{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
  </style>
</head>
<body>
<div class="page">
  <div class="header">
    <div><h1>${label}</h1><p>MAPA — Medical Assistance Portal Access &nbsp;·&nbsp; Cotabato Regional Medical Center (CRMC)</p></div>
    <div style="text-align:right;font-size:12px;color:#6b7280"><div style="font-weight:600;color:#111827">Generated: ${now}</div><div>By: ${generatedBy}</div></div>
  </div>
  <div class="meta"><div><strong>${data.length}</strong> total records &nbsp;·&nbsp; ${statusSummary}</div></div>
  <div class="actions">
    <button class="btn btn-secondary" onclick="downloadCSV()">⬇️ Download CSV</button>
    <button class="btn btn-secondary" onclick="window.print()">🖨️ Print again</button>
  </div>
  <table><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>
  <div class="footer"><p><strong>Data Privacy Notice:</strong> This report contains personal data protected under Republic Act No. 10173 (Data Privacy Act of 2012). Intended solely for authorized CRMC personnel. Do not share or distribute without proper authorization.</p></div>
</div>
<script>
  window.onload = function(){ window.print(); };
  const DATA = ${safeJson};
  function downloadCSV(){
    const keys = Object.keys(DATA[0]);
    const rows = [keys,...DATA.map(r=>keys.map(k=>r[k]))];
    const csv  = rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\\n');
    const a    = Object.assign(document.createElement('a'),{href:URL.createObjectURL(new Blob([csv],{type:'text/csv'})),download:'export-${stamp}.csv'});
    a.click();
  }
</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  window.open(url, '_blank')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
