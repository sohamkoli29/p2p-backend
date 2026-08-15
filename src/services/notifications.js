const supabase = require('../config/supabase')
const { firestore, FieldValue } = require('../config/firebase')

async function notifyAdmins({ title, message, link, entityId, type }) {
  const { data: admins, error } = await supabase.from('profiles').select('id').eq('role', 'admin')
  if (error || !admins?.length) return

  const batch = firestore.batch()
  admins.forEach((a) => {
    const ref = firestore.collection('notifications').doc()
    batch.set(ref, {
      recipient_id: a.id,
      type,
      title,
      message,
      link,
      entity_id: entityId,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    })
  })
  await batch.commit()
}

async function notifyUser({ userId, title, message, link, entityId, type }) {
  await firestore.collection('notifications').add({
    recipient_id: userId,
    type,
    title,
    message,
    link,
    entity_id: entityId,
    read: false,
    created_at: FieldValue.serverTimestamp(),
  })
}

async function notifyVendors({ vendorIds, title, message, link, entityId, type }) {
  if (!vendorIds?.length) return

  const batch = firestore.batch()
  vendorIds.forEach((vendorId) => {
    const ref = firestore.collection('notifications').doc()
    batch.set(ref, {
      recipient_id: vendorId,
      type,
      title,
      message,
      link,
      entity_id: entityId,
      read: false,
      created_at: FieldValue.serverTimestamp(),
    })
  })
  await batch.commit()
}

module.exports = { notifyAdmins, notifyUser, notifyVendors }