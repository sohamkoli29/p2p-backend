const { MongoClient } = require('mongodb')
require('dotenv').config()

const uri = process.env.MONGODB_URI
const client = new MongoClient(uri)

let db = null

async function connectMongo() {
  if (db) return db
  await client.connect()
  db = client.db('p2p_portal')
  console.log('MongoDB connected')
  return db
}

module.exports = { connectMongo }