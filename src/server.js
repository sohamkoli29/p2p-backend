const express = require('express')
const cors = require('cors')
require('dotenv').config()

const healthRoutes = require('./routes/health')
const { connectMongo } = require('./config/mongodb')

const app = express()
const PORT = process.env.PORT || 5000

app.use(cors({ origin: process.env.CLIENT_URL || '*' }))
app.use(express.json())

app.use('/api/health', healthRoutes)

async function start() {
  try {
    await connectMongo()
  } catch (err) {
    console.error('MongoDB connection failed:', err.message)
  }

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
  })
}

start()