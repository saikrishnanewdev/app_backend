const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { Client } = require("pg");

const db = new Client({
  host: "aws-0-ap-northeast-1.pooler.supabase.com",
  port: 5432,
  user: "postgres.tjolsfsmrynallrzzugd",
  database: "postgres",

  password: process.env.SUPABASE_DB_PASSWORD,

  ssl: {
    rejectUnauthorized: false
  }
});

db.connect()
  .then(() => {
    console.log("✅ Supabase PostgreSQL connected successfully!");
  })
  .catch((error) => {
    console.error("❌ Supabase PostgreSQL connection failed:");
    console.error(error.message);
  });

db.on('error', (error) => {
  console.error("❌ Database connection error (handled):", error.message);
});

module.exports = db;