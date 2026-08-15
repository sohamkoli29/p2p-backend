const { initializeApp, getApps, cert } = require('firebase-admin/app')
const { getFirestore, FieldValue } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
require('dotenv').config()

if (!getApps().length) {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64

  if (!encoded) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_BASE64 is missing from .env')
  }

  const serviceAccount = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'))

  initializeApp({
    credential: cert(serviceAccount),
  })
}

const firestore = getFirestore()
const auth = getAuth()

module.exports = { firestore, auth, FieldValue }