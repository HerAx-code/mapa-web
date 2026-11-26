const { defineSecret, defineString } = require('firebase-functions/params')

/**
 * Shared SMTP mailer for every MAPA server email (Phase 1, T1 + email
 * confirmation). One transport definition so sendNotificationEmail (the
 * in-app-notification mailer) and sendVerificationEmail (the signup
 * email-confirmation link) can't drift apart on host, auth or From header.
 *
 * SMTP login is the Functions secrets SMTP_USER / SMTP_PASS; the display From
 * address is the optional plain parameter SMTP_FROM (default "MAPA <SMTP_USER>").
 * A function that sends must list these secrets in its `secrets:` option so the
 * runtime injects them before `.value()` is read.
 */
const SMTP_USER = defineSecret('SMTP_USER')
const SMTP_PASS = defineSecret('SMTP_PASS')
const SMTP_FROM = defineString('SMTP_FROM', { default: '' })

const NETWORK_NAME = process.env.ORG_NAME || 'MAPA'

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
))

let transporter = null
function mailer() {
  if (!transporter) {
    const nodemailer = require('nodemailer')
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
    })
  }
  return transporter
}

// The default From header for MAPA email (SMTP_FROM, else "MAPA <SMTP_USER>").
function defaultFrom() {
  return SMTP_FROM.value() || `${NETWORK_NAME} <${SMTP_USER.value()}>`
}

// Send one message with the default From applied. { to, subject, text, html }.
function sendMail(message) {
  return mailer().sendMail({ from: defaultFrom(), ...message })
}

module.exports = {
  SMTP_USER, SMTP_PASS, SMTP_FROM, NETWORK_NAME, escapeHtml, mailer, defaultFrom, sendMail,
}
