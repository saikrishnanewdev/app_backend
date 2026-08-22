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

const schema = `
-- 1. Employees table
CREATE TABLE IF NOT EXISTS employees (
    id SERIAL PRIMARY KEY,
    employee_code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(100),
    designation VARCHAR(100),
    mobile VARCHAR(20),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'employee',
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 3. Attendance sessions table
CREATE TABLE IF NOT EXISTS attendance_sessions (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date DATE DEFAULT CURRENT_DATE,
    check_in TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    check_out TIMESTAMP WITH TIME ZONE,
    duration_minutes NUMERIC,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 4. Attendance summary table
CREATE TABLE IF NOT EXISTS attendance (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    attendance_date DATE NOT NULL,
    check_in TIMESTAMP WITH TIME ZONE,
    check_out TIMESTAMP WITH TIME ZONE,
    status VARCHAR(50) DEFAULT 'Absent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(employee_id, attendance_date)
);

-- 5. eSSL Devices table
CREATE TABLE IF NOT EXISTS essl_devices (
    id SERIAL PRIMARY KEY,
    device_code VARCHAR(50) UNIQUE NOT NULL,
    device_name VARCHAR(100) NOT NULL,
    model VARCHAR(50),
    ip_address VARCHAR(45),
    tcp_port INTEGER DEFAULT 4370,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 6. eSSL Employee Mapping table
CREATE TABLE IF NOT EXISTS essl_employee_mapping (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES essl_devices(id) ON DELETE CASCADE,
    essl_user_id VARCHAR(50) NOT NULL,
    employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, essl_user_id)
);

-- 7. eSSL Attendance Logs table
CREATE TABLE IF NOT EXISTS essl_attendance_logs (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES essl_devices(id) ON DELETE CASCADE,
    essl_user_id VARCHAR(50) NOT NULL,
    transaction_time TIMESTAMP WITH TIME ZONE NOT NULL,
    punch_type VARCHAR(10) NOT NULL,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, essl_user_id, transaction_time)
);
`;

async function setup() {
  try {
    console.log("Connecting to PostgreSQL/Supabase database...");
    await db.connect();
    console.log("Connected successfully. Creating tables...");
    
    await db.query(schema);
    console.log("✅ Tables created successfully!");

    // Seed default admin user: admin / admin123
    const adminUsername = 'admin';
    const adminHash = '$2b$10$gLTemIat4FBpdmBmygyQOO/eqbVHRbNOs0x.Qz0n0QbRqEk1pHWuW'; // bcrypt for admin123
    
    console.log("Checking if default admin user exists...");
    const userCheck = await db.query("SELECT id FROM users WHERE username = $1", [adminUsername]);
    
    if (userCheck.rows.length === 0) {
      console.log("Seeding default admin user (username: admin, password: admin123)...");
      await db.query(
        "INSERT INTO users (username, password_hash, role, employee_id) VALUES ($1, $2, $3, $4)",
        [adminUsername, adminHash, 'admin', null]
      );
      console.log("✅ Admin user seeded successfully!");
    } else {
      console.log("ℹ️ Admin user already exists.");
    }

    // Seed a default active device if none exists
    const deviceCheck = await db.query("SELECT id FROM essl_devices WHERE device_code = $1", ['DEV01']);
    if (deviceCheck.rows.length === 0) {
      console.log("Seeding default active device (device_code: DEV01)...");
      await db.query(
        "INSERT INTO essl_devices (device_code, device_name, model, ip_address, tcp_port, status) VALUES ($1, $2, $3, $4, $5, $6)",
        ['DEV01', 'Simulator Device', 'X2008 Simulator', '127.0.0.1', 4370, 'active']
      );
      console.log("✅ Default device DEV01 seeded successfully!");
    }

    // Seed employee 106 mapped to EMP002 Suresh Kumar
    const empCheck = await db.query("SELECT id FROM employees WHERE employee_code = $1", ['EMP002']);
    let employeeId;
    if (empCheck.rows.length === 0) {
      console.log("Seeding test employee EMP002 (Suresh Kumar)...");
      const empRes = await db.query(
        "INSERT INTO employees (employee_code, name, department, designation, mobile, status) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        ['EMP002', 'Suresh Kumar', 'Engineering', 'Software Developer', '9876543210', 'active']
      );
      employeeId = empRes.rows[0].id;
      console.log("✅ Test employee EMP002 seeded successfully!");
    } else {
      employeeId = empCheck.rows[0].id;
    }

    // Seed mapping for essl user 106 to EMP002 Suresh Kumar on device DEV01
    const deviceRes = await db.query("SELECT id FROM essl_devices WHERE device_code = $1", ['DEV01']);
    const deviceId = deviceRes.rows[0].id;
    const mapCheck = await db.query(
      "SELECT id FROM essl_employee_mapping WHERE device_id = $1 AND essl_user_id = $2",
      [deviceId, '106']
    );
    if (mapCheck.rows.length === 0) {
      console.log("Seeding biometric mapping (Device DEV01 User 106 -> EMP002)...");
      await db.query(
        "INSERT INTO essl_employee_mapping (device_id, essl_user_id, employee_id) VALUES ($1, $2, $3)",
        [deviceId, '106', employeeId]
      );
      console.log("✅ Biometric mapping seeded successfully!");
    }

  } catch (error) {
    console.error("❌ Database setup failed:");
    console.error(error);
  } finally {
    await db.end();
    console.log("Connection closed.");
  }
}

setup();
