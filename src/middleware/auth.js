const supabase = require('../config/supabase')

// Verifies the Supabase-issued JWT sent from the frontend, then attaches
// both the raw auth user and their profile row (with role) to req.
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' })
  }

  const token = authHeader.split(' ')[1]

  const { data, error } = await supabase.auth.getUser(token)

  if (error || !data?.user) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', data.user.id)
    .single()

  if (profileError || !profile) {
    return res.status(403).json({ error: 'No profile found for this user' })
  }

  req.user = data.user
  req.profile = profile
  next()
}

module.exports = verifyToken