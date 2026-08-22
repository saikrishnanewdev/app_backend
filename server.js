const nodemailer = require("nodemailer");
﻿const express = require("express");
const cors = require("cors");
const db = require("./db");

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors({
    origin: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));

const PORT = process.env.PORT || 3000;

// Ensure email column exists on employees table
db.query("ALTER TABLE employees ADD COLUMN IF NOT EXISTS email VARCHAR(255)")
  .then(() => db.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS email VARCHAR(255)"))
  .then(() => db.query("UPDATE users SET email = 'admin@gmail.com' WHERE username = 'admin' AND email IS NULL"))
  .then(() => console.log("✅ users.email column verified/added successfully."))
  .then(() => console.log("✅ employees.email column verified/added successfully."))
  .catch(err => console.error("❌ Error verifying employees.email column:", err));
// =====================================================
// CONFIGURATION
// =====================================================

const JWT_SECRET = process.env.JWT_SECRET;

app.use(express.json());

// =====================================================
// JWT AUTHENTICATION MIDDLEWARE
// =====================================================

function authenticateToken(req, res, next) {

    console.log("AUTH HEADER:", req.headers.authorization);

    const authHeader = req.headers["authorization"];

    const token =
        authHeader && authHeader.split(" ")[1];

    if (!token) {

        return res.status(401).json({
            error: "Access token required"
        });

    }

    try {

        const decoded = jwt.verify(
            token,
            JWT_SECRET
        );

        req.user = decoded;

        next();

    } catch (error) {

        return res.status(403).json({
            error: "Invalid or expired token"
        });

    }
}

// =====================================================
// ROLE AUTHORIZATION MIDDLEWARE
// =====================================================

function requireRole(role) {

    return (req, res, next) => {

        if (!req.user) {

            return res.status(401).json({
                error: "Authentication required"
            });

        }

        if (req.user.role !== role) {

            return res.status(403).json({
                error: "Access denied"
            });

        }

        next();

    };
}

// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {

    res.send(
        "Attendance App Backend is working " +
        String.fromCodePoint(0x1F680)
    );

});

// =====================================================
// GET ALL EMPLOYEES
// ADMIN ONLY
// =====================================================

app.get(
    "/employees",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const result = await db.query(
                `SELECT *
                 FROM employees
                 ORDER BY id`
            );

            res.json(result.rows);

        } catch (error) {

            console.error(
                "Get Employees Error:",
                error
            );

            res.status(500).json({
                error: "Database error"
            });

        }

    }
);
// =====================================================
// ADD EMPLOYEE
// ADMIN ONLY
// =====================================================

app.post(
    "/employees",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const {
                employee_code,
                name,
                department,
                designation,
                mobile
            } = req.body;

            // -------------------------------------------------
            // Validate required fields
            // -------------------------------------------------

            if (
                !employee_code ||
                !name
            ) {

                return res.status(400).json({
                    error:
                        "employee_code and name are required"
                });

            }

            // -------------------------------------------------
            // Check duplicate employee code
            // -------------------------------------------------

            const existingEmployee =
                await db.query(
                    `SELECT id
                     FROM employees
                     WHERE employee_code = $1`,
                    [employee_code]
                );

            if (
                existingEmployee.rows.length > 0
            ) {

                return res.status(409).json({
                    error:
                        "Employee code already exists"
                });

            }

            // -------------------------------------------------
            // Create employee
            // -------------------------------------------------

            const result =
                await db.query(
                    `INSERT INTO employees
                    (
                        employee_code,
                        name,
                        department,
                        designation,
                        mobile,
                        status
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6
                    )
                    RETURNING *`,
                    [
                        employee_code,
                        name,
                        department || null,
                        designation || null,
                        mobile || null,
                        "Active"
                    ]
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            // -------------------------------------------------
            // Auto-Map and Push to Biometric Devices
            // -------------------------------------------------
            const employee = result.rows[0];
            try {
                const devicesResult = await db.query(
                    "SELECT id, device_code FROM essl_devices WHERE status = 'active'"
                );

                for (const device of devicesResult.rows) {
                    // 1. Create mapping in database
                    await db.query(
                        `INSERT INTO essl_employee_mapping (device_id, essl_user_id, employee_id)
                         VALUES ($1, $2, $3)
                         ON CONFLICT DO NOTHING`,
                        [device.id, String(employee_code), employee.id]
                    );

                    // 2. Enqueue ADMS push command
                    await db.query(
                        `INSERT INTO adms_commands (device_code, command_string, status)
                         VALUES ($1, $2, 'pending')`,
                        [
                            device.device_code,
                            `DATA UPDATE USERINFO PIN=${employee_code}\tName=${name}\tPri=0`
                        ]
                    );
                    console.log(`✅ Auto-mapped and enqueued push command for employee ${name} (PIN: ${employee_code}) to device ${device.device_code}`);
                }
            } catch (err) {
                console.error("⚠️ Error in auto-mapping / pushing to ADMS:", err);
            }

            return res.status(201).json({

                message:
                    "Employee created successfully",

                employee:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Add Employee Error:",
                error
            );

            return res.status(500).json({
                error:
                    "Failed to create employee"
            });

        }

    }
);
// =====================================================
// REGISTER EMPLOYEE WITH eSSL BIOMETRIC USER
// ADMIN ONLY
// =====================================================

app.post(
    "/api/essl/register-employee",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const {
                device_code,
                essl_user_id,
                employee_code,
                name,
                department,
                designation,
                mobile
            } = req.body;

            // -------------------------------------------------
            // Validate required fields
            // -------------------------------------------------

            if (
                !device_code ||
                !essl_user_id ||
                !employee_code ||
                !name
            ) {

                return res.status(400).json({

                    error:
                        "device_code, essl_user_id, employee_code and name are required"

                });

            }

            // -------------------------------------------------
            // Find eSSL device
            // -------------------------------------------------

            const deviceResult =
                await db.query(
                    `SELECT
                        id,
                        device_code,
                        device_name,
                        model,
                        status
                     FROM essl_devices
                     WHERE device_code = $1`,
                    [device_code]
                );

            if (
                deviceResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "eSSL device not registered"

                });

            }

            const device =
                deviceResult.rows[0];

            // -------------------------------------------------
            // Check device status
            // -------------------------------------------------

            if (
                device.status !== "active"
            ) {

                return res.status(403).json({

                    error:
                        "eSSL device is inactive"

                });

            }

            // -------------------------------------------------
            // Check duplicate employee code
            // -------------------------------------------------

            const existingEmployee =
                await db.query(
                    `SELECT id
                     FROM employees
                     WHERE employee_code = $1`,
                    [employee_code]
                );

            if (
                existingEmployee.rows.length > 0
            ) {

                return res.status(409).json({

                    error:
                        "Employee code already exists"

                });

            }

            // -------------------------------------------------
            // Check whether eSSL user is already mapped
            // -------------------------------------------------

            const existingMapping =
                await db.query(
                    `SELECT
                        id,
                        employee_id
                     FROM essl_employee_mapping
                     WHERE device_id = $1
                     AND essl_user_id = $2`,
                    [
                        device.id,
                        String(essl_user_id)
                    ]
                );

            if (
                existingMapping.rows.length > 0
            ) {

                return res.status(409).json({

                    error:
                        "eSSL user is already mapped to an employee",

                    mapping:
                        existingMapping.rows[0]

                });

            }

            // -------------------------------------------------
            // Create employee
            // -------------------------------------------------

            const employeeResult =
                await db.query(
                    `INSERT INTO employees
                    (
                        employee_code,
                        name,
                        department,
                        designation,
                        mobile,
                        status
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5,
                        $6
                    )
                    RETURNING *`,
                    [
                        employee_code,
                        name,
                        department || null,
                        designation || null,
                        mobile || null,
                        "Active"
                    ]
                );

            const employee =
                employeeResult.rows[0];

            // -------------------------------------------------
            // Create eSSL mapping
            // -------------------------------------------------

            const mappingResult =
                await db.query(
                    `INSERT INTO essl_employee_mapping
                    (
                        device_id,
                        essl_user_id,
                        employee_id
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3
                    )
                    RETURNING *`,
                    [
                        device.id,
                        String(essl_user_id),
                        employee.id
                    ]
                );

            const mapping =
                mappingResult.rows[0];

            // -------------------------------------------------
            // Success
            // -------------------------------------------------

            return res.status(201).json({

                message:
                    "Employee and eSSL biometric mapping created successfully",

                device: {

                    id:
                        device.id,

                    device_code:
                        device.device_code,

                    device_name:
                        device.device_name,

                    model:
                        device.model

                },

                employee:
                    employee,

                essl_mapping:
                    mapping

            });

        } catch (error) {

            console.error(
                "eSSL Employee Registration Error:",
                error
            );

            return res.status(500).json({

                error:
                    "Failed to register employee with eSSL"

            });

        }

    }
);










// =====================================================
// IMPORT EMPLOYEES
// ADMIN ONLY
// =====================================================

app.post(
    "/employees/import",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        console.log(">>> EMPLOYEE IMPORT ROUTE HIT <<<");
        console.log("IMPORT USER:", req.user);
        console.log("IMPORT BODY:", req.body);

        try {

            const { employees } = req.body;

            // -------------------------------------------------
            // Validate request
            // -------------------------------------------------

            if (
                !Array.isArray(employees) ||
                employees.length === 0
            ) {

                return res.status(400).json({
                    error:
                        "employees array is required and cannot be empty"
                });

            }

            // -------------------------------------------------
            // Maximum bulk import
            // -------------------------------------------------

            if (employees.length > 1000) {

                return res.status(400).json({
                    error:
                        "Maximum 1000 employees can be imported at once"
                });

            }

            // -------------------------------------------------
            // Validate rows
            // -------------------------------------------------

            const seenCodes = new Set();
            const errors = [];

            for (
                let i = 0;
                i < employees.length;
                i++
            ) {

                const employee =
                    employees[i];

                const employeeCode =
                    employee?.employee_code
                        ?.toString()
                        .trim();

                const name =
                    employee?.name
                        ?.toString()
                        .trim();

                if (!employeeCode) {

                    errors.push({
                        row: i + 1,
                        error:
                            "employee_code is required"
                    });

                    continue;
                }

                if (!name) {

                    errors.push({
                        row: i + 1,
                        employee_code:
                            employeeCode,
                        error:
                            "name is required"
                    });

                    continue;
                }

                const normalizedCode =
                    employeeCode.toUpperCase();

                if (
                    seenCodes.has(
                        normalizedCode
                    )
                ) {

                    errors.push({
                        row: i + 1,
                        employee_code:
                            employeeCode,
                        error:
                            "Duplicate employee code in import file"
                    });

                    continue;
                }

                seenCodes.add(
                    normalizedCode
                );
            }

            if (errors.length > 0) {

                return res.status(400).json({
                    error:
                        "Import validation failed",
                    details: errors
                });

            }

            // -------------------------------------------------
            // Start transaction
            // -------------------------------------------------

            await db.query("BEGIN");

            // -------------------------------------------------
            // Check existing employee codes
            // -------------------------------------------------

            const codes =
                employees.map(
                    employee =>
                        employee.employee_code
                            .toString()
                            .trim()
                );

            const existingResult =
                await db.query(
                    `SELECT employee_code
                     FROM employees
                     WHERE UPPER(employee_code) = ANY($1::text[])`,
                    [
                        codes.map(
                            code =>
                                code.toUpperCase()
                        )
                    ]
                );

            if (
                existingResult.rows.length > 0
            ) {

                await db.query(
                    "ROLLBACK"
                );

                return res.status(409).json({

                    error:
                        "Some employee codes already exist",

                    existing_codes:
                        existingResult.rows.map(
                            row =>
                                row.employee_code
                        )

                });

            }

            // -------------------------------------------------
            // Insert employees
            // -------------------------------------------------

            const importedEmployees = [];

            for (
                const employee
                of employees
            ) {

                const employeeCode =
                    employee.employee_code
                        .toString()
                        .trim();

                const name =
                    employee.name
                        .toString()
                        .trim();

                const department =
                    employee.department
                        ?.toString()
                        .trim() || null;

                const designation =
                    employee.designation
                        ?.toString()
                        .trim() || null;

                const mobile =
                    employee.mobile
                        ?.toString()
                        .trim() || null;

                const status =
                    employee.status
                        ?.toString()
                        .trim() || "Active";

                const email =
                    employee.email
                        ?.toString()
                        .trim() || null;

                const role =
                    employee.role
                        ?.toString()
                        .trim() || "employee";

                const result =
                    await db.query(
                        `INSERT INTO employees
                        (
                            employee_code,
                            name,
                            department,
                            designation,
                            mobile,
                            status,
                            email
                        )
                        VALUES
                        (
                            $1, $2, $3, $4, $5, $6, $7
                        )
                        RETURNING *`,
                        [
                            employeeCode,
                            name,
                            department,
                            designation,
                            mobile,
                            status,
                            email
                        ]
                    );

                const newEmployee = result.rows[0];
                importedEmployees.push(newEmployee);

                // Auto-create user account if email is provided
                if (email) {
                    const username = email.split("@")[0].toLowerCase();
                    
                    const userCheck = await db.query(
                        `SELECT id FROM users WHERE username = $1`,
                        [username]
                    );
                    
                    if (userCheck.rows.length === 0) {
                        const dummyPasswordHash = await bcrypt.hash("google_dummy_password_123!", 10);
                        await db.query(
                            `INSERT INTO users (username, password_hash, role, employee_id, email)
                             VALUES ($1, $2, $3, $4, $5)`,
                            [username, dummyPasswordHash, role.toLowerCase(), newEmployee.id, email.toLowerCase()]
                        );
                        console.log(`Created user account for imported employee: ${username} (${email}) with role: ${role}`);
                    } else {
                        await db.query(
                            `UPDATE users
                             SET role = $1, employee_id = $2
                             WHERE username = $3`,
                            [role.toLowerCase(), newEmployee.id, username]
                        );
                    }
                }
            }

            // -------------------------------------------------
            // Commit
            // -------------------------------------------------

            await db.query(
                "COMMIT"
            );

            return res.status(201).json({

                message:
                    "Employees imported successfully",

                imported_count:
                    importedEmployees.length,

                employees:
                    importedEmployees

            });

        } catch (error) {

            // -------------------------------------------------
            // Rollback
            // -------------------------------------------------

            try {
                await db.query(
                    "ROLLBACK"
                );
            } catch (_) {}

            console.error(
                "Import Employees Error:",
                error
            );

            return res.status(500).json({

                error:
                    "Failed to import employees"

            });

        } finally {

            

        }

    }
);

// =====================================================
// UPDATE EMPLOYEE
// ADMIN ONLY
// =====================================================

app.put(
    "/employees/:id",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const { id } = req.params;

            const {
                name,
                department,
                designation,
                mobile,
                status
            } = req.body;

            // -------------------------------------------------
            // Validate employee ID
            // -------------------------------------------------

            if (!id) {

                return res.status(400).json({
                    error: "Employee ID is required"
                });

            }

            // -------------------------------------------------
            // Check employee exists
            // -------------------------------------------------

            const existingEmployee =
                await db.query(
                    `SELECT *
                     FROM employees
                     WHERE id = $1`,
                    [id]
                );

            if (
                existingEmployee.rows.length === 0
            ) {

                return res.status(404).json({
                    error: "Employee not found"
                });

            }

            // -------------------------------------------------
            // Update employee
            // -------------------------------------------------

            const result =
                await db.query(
                    `UPDATE employees

                     SET
                        name = $1,
                        department = $2,
                        designation = $3,
                        mobile = $4,
                        status = $5

                     WHERE id = $6

                     RETURNING *`,
                    [
                        name,
                        department || null,
                        designation || null,
                        mobile || null,
                        status || "Active",
                        id
                    ]
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            return res.json({

                message:
                    "Employee updated successfully",

                employee:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Update Employee Error:",
                error
            );

            return res.status(500).json({

                error:
                    "Failed to update employee"

            });

        }

    }
);
// =====================================================
// DELETE EMPLOYEE
// ADMIN ONLY
// =====================================================

app.delete(
    "/employees/:id",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const { id } = req.params;

            // -------------------------------------------------
            // Validate employee ID
            // -------------------------------------------------

            if (!id) {

                return res.status(400).json({
                    error: "Employee ID is required"
                });

            }

            // -------------------------------------------------
            // Check employee exists
            // -------------------------------------------------

            const existingEmployee =
                await db.query(
                    `SELECT *
                     FROM employees
                     WHERE id = $1`,
                    [id]
                );

            if (existingEmployee.rows.length === 0) {

                return res.status(404).json({
                    error: "Employee not found"
                });

            }

            // -------------------------------------------------
            // Delete employee
            // -------------------------------------------------

            const result =
                await db.query(
                    `DELETE FROM employees
                     WHERE id = $1
                     RETURNING *`,
                    [id]
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            return res.json({

                message:
                    "Employee deleted successfully",

                employee:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Delete Employee Error:",
                error
            );

            return res.status(500).json({

                error:
                    "Failed to delete employee",
                      details: error.message

            });

        }

    }

);

// =====================================================
// CHECK-IN
// SESSION BASED
// =====================================================

app.post(
    "/attendance/check-in",
    authenticateToken,
    async (req, res) => {

        try {

            let { employee_id } = req.body;

            // Employee can only check-in themselves
            if (req.user.role === "employee") {

                employee_id =
                    req.user.employee_id;

            }

            // Validate employee ID
            if (!employee_id) {

                return res.status(400).json({
                    error: "employee_id is required"
                });

            }

            // -------------------------------------------------
            // Check employee exists
            // -------------------------------------------------

            const employeeResult =
                await db.query(
                    `SELECT *
                     FROM employees
                     WHERE id = $1`,
                    [employee_id]
                );

            if (
                employeeResult.rows.length === 0
            ) {

                return res.status(404).json({
                    error: "Employee not found"
                });

            }

            // -------------------------------------------------
            // Check open session
            // -------------------------------------------------

            const openSession =
                await db.query(
                    `SELECT *
                     FROM attendance_sessions
                     WHERE employee_id = $1
                     AND check_out IS NULL
                     ORDER BY id DESC
                     LIMIT 1`,
                    [employee_id]
                );

            if (
                openSession.rows.length > 0
            ) {

                return res.status(400).json({

                    error:
                        "Employee is already checked in",

                    session:
                        openSession.rows[0]

                });

            }

            // -------------------------------------------------
            // Create session
            // -------------------------------------------------

            const result =
    await db.query(

        `INSERT INTO attendance_sessions
        (
            employee_id,
            attendance_date,
            check_in
        )
        VALUES
        (
            $1,
            CURRENT_DATE,
            CURRENT_TIMESTAMP
        )
        RETURNING
            id,
            employee_id,
            TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
            check_in,
            check_out,
            duration_minutes,
            created_at`,

        [employee_id]

    );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.status(201).json({

                message:
                    "Check-in successful",

                session:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Check-In Error:",
                error
            );

            res.status(500).json({
                error: "Check-in failed"
            });

        }

    }
);

// =====================================================
// CHECK-OUT
// SESSION BASED
// =====================================================

app.post(
    "/attendance/check-out",
    authenticateToken,
    async (req, res) => {

        try {

            let { employee_id } = req.body;

            // Employee can only checkout themselves
            if (req.user.role === "employee") {

                employee_id =
                    req.user.employee_id;

            }

            // Validate
            if (!employee_id) {

                return res.status(400).json({
                    error: "employee_id is required"
                });

            }

            // -------------------------------------------------
            // Find open session
            // -------------------------------------------------

            const sessionResult =
                await db.query(
                    `SELECT *
                     FROM attendance_sessions
                     WHERE employee_id = $1
                     AND check_out IS NULL
                     ORDER BY id DESC
                     LIMIT 1`,
                    [employee_id]
                );

            if (
                sessionResult.rows.length === 0
            ) {

                return res.status(400).json({
                    error:
                        "Employee is not currently checked in"
                });

            }

            const session =
                sessionResult.rows[0];

            // -------------------------------------------------
            // Close session
            // Calculate duration
            // -------------------------------------------------

            const result = await db.query(
        `UPDATE attendance_sessions
         SET
            check_out = CURRENT_TIMESTAMP,
            duration_minutes =
                EXTRACT(
                    EPOCH FROM
                    (CURRENT_TIMESTAMP - check_in)
                ) / 60
         WHERE id = $1
         RETURNING
            id,
            employee_id,
            TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
            check_in,
            check_out,
            duration_minutes,
            created_at`,
        [session.id]
    );

            const updatedSession =
                  result.rows[0];

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                message:
                    "Check-out successful",

                session:
                    updatedSession

            });

        } catch (error) {

            console.error(
                "Check-Out Error:",
                error
            );

            res.status(500).json({
                error: "Check-out failed"
            });

        }

    }
);

// =====================================================
// EMPLOYEE ATTENDANCE HISTORY
// =====================================================
// =====================================================
// ATTENDANCE STATUS
// EMPLOYEE SELF STATUS
// =====================================================

app.get(
    "/attendance/status",
    authenticateToken,
    async (req, res) => {
        console.log(">>> ATTENDANCE STATUS ROUTE HIT <<<");
        console.log("USER:", req.user);

        try {

            const employee_id =
                req.user.employee_id;

            // -------------------------------------------------
            // Validate employee
            // -------------------------------------------------

            if (!employee_id) {

                return res.status(400).json({
                    error: "Employee ID not found"
                });

            }

            // -------------------------------------------------
            // Get today's attendance sessions
            // -------------------------------------------------

            const result =
                await db.query(

                    `SELECT
                        id,
                        employee_id,
                        TO_CHAR(
                            attendance_date,
                            'YYYY-MM-DD'
                        ) AS attendance_date,
                        check_in,
                        check_out,
                        duration_minutes,
                        created_at

                     FROM attendance_sessions

                     WHERE employee_id = $1

                     AND attendance_date =
                         CURRENT_DATE

                     ORDER BY id DESC`,

                    [employee_id]

                );

            // -------------------------------------------------
            // No attendance today
            // -------------------------------------------------

            if (result.rows.length === 0) {

                return res.json({

                    status:
                        "NOT_CHECKED_IN",

                    employee_id:
                        employee_id,

                    sessions: []

                });

            }

            // -------------------------------------------------
            // Check for open session
            // -------------------------------------------------

            const openSession =
                result.rows.find(
                    session =>
                        session.check_out === null
                );

            // -------------------------------------------------
            // Currently working
            // -------------------------------------------------

            if (openSession) {

                return res.json({

                    status:
                        "CHECKED_IN",

                    employee_id:
                        employee_id,

                    session:
                        openSession,

                    sessions:
                        result.rows

                });

            }

            // -------------------------------------------------
            // All sessions completed
            // -------------------------------------------------

            return res.json({

                status:
                    "CHECKED_OUT",

                employee_id:
                    employee_id,

                session:
                    result.rows[0],

                sessions:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Attendance Status Error:",
                error
            );

            return res.status(500).json({

                error:
                    "Unable to get attendance status"

            });

        }

    }
);

app.get(
    "/attendance/:employee_id",
    authenticateToken,
    async (req, res) => {
        console.log(">>> EMPLOYEE ATTENDANCE HISTORY ROUTE HIT <<<");
        console.log("PARAM:", req.params.employee_id);
        console.log("USER:", req.user);

        try {

            const { employee_id } =
                req.params;

            // -------------------------------------------------
            // Employee can only see own history
            // -------------------------------------------------

            if (
                req.user.role === "employee" &&
                Number(employee_id) !==
                    Number(req.user.employee_id)
            ) {

                return res.status(403).json({
                    error: "Access denied"
                });

            }

            // -------------------------------------------------
            // Get attendance sessions
            // -------------------------------------------------

            const result =
                await db.query(
                    `SELECT
                        id,
                        employee_id,
                        TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,
                        check_in,
                        check_out,
                        duration_minutes,
                        created_at

                     FROM attendance_sessions

                     WHERE employee_id = $1

                     ORDER BY
                        attendance_date DESC,
                        check_in DESC`,
                    [employee_id]
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                employee_id:
                    Number(employee_id),

                sessions:
                    result.rows

            });

        } catch (error) {

            console.error(
                "Attendance History Error:",
                error
            );

            res.status(500).json({

                error:
                    "Failed to fetch attendance history"

            });

        }

    }
);

// =====================================================
// DAILY SUMMARY
// =====================================================

app.get(
    "/attendance/summary/:employee_id",
    authenticateToken,
    async (req, res) => {
        

        try {

            const { employee_id } =
                req.params;

            // -------------------------------------------------
            // Employee can only see own summary
            // -------------------------------------------------

            if (
                req.user.role === "employee" &&
                Number(employee_id) !==
                    Number(req.user.employee_id)
            ) {

                return res.status(403).json({
                    error: "Access denied"
                });

            }

            // -------------------------------------------------
            // Get employee
            // -------------------------------------------------

            const employeeResult =
                await db.query(
                    `SELECT
                        id,
                        employee_code,
                        name,
                        department,
                        designation

                     FROM employees

                     WHERE id = $1`,
                    [employee_id]
                );

            if (
                employeeResult.rows.length === 0
            ) {

                return res.status(404).json({
                    error: "Employee not found"
                });

            }

            const employee =
                employeeResult.rows[0];

            // -------------------------------------------------
            // Get today's sessions
            // -------------------------------------------------

            const result =
                await db.query(
                    `SELECT
                        id,
                        attendance_date,
                        check_in,
                        check_out,
                        duration_minutes

                     FROM attendance_sessions

                     WHERE employee_id = $1

                     AND attendance_date =
                         CURRENT_DATE

                     ORDER BY check_in`,
                    [employee_id]
                );

            const sessions =
                result.rows;

            // -------------------------------------------------
            // Calculate total minutes
            // -------------------------------------------------

            const totalMinutes =
                sessions.reduce(
                    (total, session) => {

                        return total +
                            Number(
                                session.duration_minutes || 0
                            );

                    },
                    0
                );

            // -------------------------------------------------
            // Convert to hours
            // -------------------------------------------------

            const totalHours =
                Math.floor(
                    totalMinutes / 60
                );

            const remainingMinutes =
                totalMinutes % 60;

            // -------------------------------------------------
            // Current working status
            // -------------------------------------------------

            const currentlyWorking =
                sessions.some(
                    session =>
                        session.check_out === null
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                date:
                    new Date()
                        .toISOString()
                        .split("T")[0],

                employee:
                    employee,

                sessions:
                    sessions,

                total_sessions:
                    sessions.length,

                total_working_minutes:
                    totalMinutes,

                total_working_hours:
                    `${totalHours} hours ${remainingMinutes} minutes`,

                currently_working:
                    currentlyWorking

            });

        } catch (error) {

            console.error(
                "Daily Summary Error:",
                error
            );

            res.status(500).json({

                error:
                    "Failed to generate daily summary"

            });

        }

    }
);

// =====================================================
// DATE RANGE ATTENDANCE REPORT
// =====================================================

app.get(
    "/attendance/report/:employee_id",
    authenticateToken,
    async (req, res) => {

        try {

            const { employee_id } =
                req.params;

            const { from, to } =
                req.query;

            // -------------------------------------------------
            // Employee can only see own report
            // -------------------------------------------------

            if (
                req.user.role === "employee" &&
                Number(employee_id) !==
                    Number(req.user.employee_id)
            ) {

                return res.status(403).json({
                    error: "Access denied"
                });

            }

            // -------------------------------------------------
            // Validate dates
            // -------------------------------------------------

            if (!from || !to) {

                return res.status(400).json({

                    error:
                        "from and to dates are required"

                });

            }

            // -------------------------------------------------
            // Validate date format
            // -------------------------------------------------

            const dateRegex =
                /^\d{4}-\d{2}-\d{2}$/;

            if (
                !dateRegex.test(from) ||
                !dateRegex.test(to)
            ) {

                return res.status(400).json({

                    error:
                        "Dates must be in YYYY-MM-DD format"

                });

            }

            // -------------------------------------------------
            // Validate date order
            // -------------------------------------------------

            if (from > to) {

                return res.status(400).json({

                    error:
                        "from date cannot be after to date"

                });

            }

            // -------------------------------------------------
            // Check employee
            // -------------------------------------------------

            const employeeResult =
                await db.query(
                    `SELECT
                        id,
                        employee_code,
                        name,
                        department,
                        designation

                     FROM employees

                     WHERE id = $1`,
                    [employee_id]
                );

            if (
                employeeResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "Employee not found"

                });

            }

            const employee =
                employeeResult.rows[0];

            // -------------------------------------------------
            // Get daily attendance
            // -------------------------------------------------

            const result =
                await db.query(
                    `SELECT

                        TO_CHAR(attendance_date, 'YYYY-MM-DD') AS attendance_date,

                        TO_CHAR(MIN(check_in) AT TIME ZONE 'Asia/Calcutta',
                              'YYYY-MM-DD HH24:MI:SS') AS first_check_in,

                        TO_CHAR(MAX(check_out) AT TIME ZONE 'Asia/Calcutta',
                               'YYYY-MM-DD HH24:MI:SS') AS final_check_out,
                        COUNT(*)
                            AS total_sessions,

                        COALESCE(
                            SUM(duration_minutes),
                            0
                        )
                            AS total_working_minutes

                     FROM attendance_sessions

                     WHERE employee_id = $1

                     AND attendance_date
                         BETWEEN $2 AND $3

                     GROUP BY
                         attendance_date

                     ORDER BY
                         attendance_date`,
                    [
                        employee_id,
                        from,
                        to
                    ]
                );

            // -------------------------------------------------
            // Convert PostgreSQL values
            // -------------------------------------------------

            const dailyReport =
                result.rows.map(day => ({

                    attendance_date:
                         day.attendance_date instanceof Date
                            ? day.attendance_date.toISOString().split('T')[0]
                            : day.attendance_date,

                    first_check_in:
                        day.first_check_in,

                    final_check_out:
                        day.final_check_out,

                    total_sessions:
                        Number(
                            day.total_sessions
                        ),

                    total_working_minutes:
                        Number(
                            day.total_working_minutes
                        )

                }));

            // -------------------------------------------------
            // Calculate total working minutes
            // -------------------------------------------------

            const totalWorkingMinutes =
                dailyReport.reduce(
                    (total, day) => {

                        return total +
                            day.total_working_minutes;

                    },
                    0
                );

            // -------------------------------------------------
            // Convert total minutes
            // -------------------------------------------------

            const totalHours =
                Math.floor(
                    totalWorkingMinutes / 60
                );

            const remainingMinutes =
                totalWorkingMinutes % 60;

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                employee:
                    employee,

                period: {

                    from:
                        from,

                    to:
                        to

                },

                working_days:
                    dailyReport.length,

                total_working_minutes:
                    totalWorkingMinutes,

                total_working_hours:
                    `${totalHours} hours ${remainingMinutes} minutes`,

                daily_report:
                    dailyReport,

                sessions:
                    dailyReport

            });

        } catch (error) {

            console.error(
                "Date Range Report Error:",
                error
            );

            res.status(500).json({

                error:
                    "Failed to generate attendance report"

            });

        }

    }
);

// =====================================================
// ADMIN DASHBOARD
// =====================================================

app.get(
    "/admin/dashboard",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            // -------------------------------------------------
            // Total employees
            // -------------------------------------------------

            const employeesResult =
                await db.query(
                    `SELECT
                        COUNT(*) AS total_employees
                     FROM employees`
                );

            const totalEmployees =
                Number(
                    employeesResult
                        .rows[0]
                        .total_employees
                );

            // -------------------------------------------------
            // Employee attendance status
            // -------------------------------------------------

            const attendanceResult =
                await db.query(

                    `SELECT

                        e.id,

                        e.employee_code,

                        e.name,

                        e.department,

                        e.designation,

                        MIN(s.check_in)
                            AS first_check_in,

                        MAX(s.check_out)
                            AS last_check_out,

                        COUNT(s.id)
                            AS total_sessions,

                        COALESCE(
                            SUM(
                                s.duration_minutes
                            ),
                            0
                        )
                            AS total_working_minutes,

                        CASE

                            WHEN COUNT(s.id) = 0
                                THEN 'Absent'

                            WHEN COUNT(*) FILTER (
                                WHERE
                                    s.check_out IS NULL
                            ) > 0
                                THEN 'Currently Working'

                            ELSE
                                'Checked Out'

                        END AS status

                    FROM employees e

                    LEFT JOIN attendance_sessions s

                    ON e.id = s.employee_id

                    AND s.attendance_date =
                        CURRENT_DATE

                    GROUP BY

                        e.id,

                        e.employee_code,

                        e.name,

                        e.department,

                        e.designation

                    ORDER BY e.id`

                );

            const employees =
                attendanceResult.rows;

            // -------------------------------------------------
            // Counts
            // -------------------------------------------------

            const present =
                employees.filter(
                    employee =>
                        employee.status !==
                        "Absent"
                ).length;

            const currentlyWorking =
                employees.filter(
                    employee =>
                        employee.status ===
                        "Currently Working"
                ).length;

            const checkedOut =
                employees.filter(
                    employee =>
                        employee.status ===
                        "Checked Out"
                ).length;

            const absent =
                employees.filter(
                    employee =>
                        employee.status ===
                        "Absent"
                ).length;

            // -------------------------------------------------
            // Total working minutes
            // -------------------------------------------------

            const totalWorkingMinutes =
                employees.reduce(
                    (total, employee) => {

                        return total +
                            Number(
                                employee.total_working_minutes
                            );

                    },
                    0
                );

            // -------------------------------------------------
            // Convert minutes
            // -------------------------------------------------

            const totalHours =
                Math.floor(
                    totalWorkingMinutes / 60
                );

            const remainingMinutes =
                totalWorkingMinutes % 60;

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                date:
                    new Date()
                        .toISOString()
                        .split("T")[0],

                summary: {

                    total_employees:
                        totalEmployees,

                    present:
                        present,

                    absent:
                        absent,

                    currently_working:
                        currentlyWorking,

                    checked_out:
                        checkedOut,

                    total_working_minutes:
                        totalWorkingMinutes,

                    total_working_hours:
                        `${totalHours} hours ${remainingMinutes} minutes`

                },

                employees:
                    employees

            });

        } catch (error) {

            console.error(
                "Admin Dashboard Error:",
                error
            );

            res.status(500).json({

                error:
                    "Failed to load admin dashboard"

            });

        }

    }
);

// =====================================================
// REGISTER USER
// ADMIN ONLY
// =====================================================

app.post(
    "/auth/register",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const {
                username,
                password,
                role,
                employee_id
            } = req.body;

            // -------------------------------------------------
            // Validate required fields
            // -------------------------------------------------

            if (
                !username ||
                !password ||
                !role
            ) {

                return res.status(400).json({

                    error:
                        "username, password and role are required"

                });

            }

            // -------------------------------------------------
            // Validate role
            // -------------------------------------------------

            if (
                role !== "admin" &&
                role !== "employee"
            ) {

                return res.status(400).json({

                    error:
                        "role must be admin or employee"

                });

            }

            // -------------------------------------------------
            // Employee must have employee_id
            // -------------------------------------------------

            if (
                role === "employee" &&
                !employee_id
            ) {

                return res.status(400).json({

                    error:
                        "employee_id is required for employee"

                });

            }

            // -------------------------------------------------
            // Check username
            // -------------------------------------------------

            const existingUser =
                await db.query(
                    `SELECT id
                     FROM users
                     WHERE username = $1`,
                    [username]
                );

            if (
                existingUser.rows.length > 0
            ) {

                return res.status(409).json({

                    error:
                        "Username already exists"

                });

            }

            // -------------------------------------------------
            // Hash password
            // -------------------------------------------------

            const passwordHash =
                await bcrypt.hash(
                    password,
                    10
                );

            // -------------------------------------------------
            // Create user
            // -------------------------------------------------

            const result =
                await db.query(
                    `INSERT INTO users
                    (
                        username,
                        password_hash,
                        role,
                        employee_id
                    )
                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4
                    )
                    RETURNING
                        id,
                        username,
                        role,
                        employee_id,
                        created_at`,
                    [
                        username,
                        passwordHash,
                        role,
                        employee_id || null
                    ]
                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.status(201).json({

                message:
                    "User registered successfully",

                user:
                    result.rows[0]

            });

        } catch (error) {

            console.error(
                "Registration Error:",
                error
            );

            res.status(500).json({

                error:
                    "Registration failed"

            });

        }

    }
);

// =====================================================
// LOGIN
// =====================================================

app.post(
    "/auth/login",
    async (req, res) => {

        try {

            const {
                username,
                password
            } = req.body;

            // -------------------------------------------------
            // Validate
            // -------------------------------------------------

            if (
                !username ||
                !password
            ) {

                return res.status(400).json({

                    error:
                        "username and password are required"

                });

            }

            // -------------------------------------------------
            // Find user
            // -------------------------------------------------

            const result =
                await db.query(
                    `SELECT
                        id,
                        username,
                        password_hash,
                        role,
                        employee_id

                     FROM users

                     WHERE username = $1`,
                    [username]
                );

            if (
                result.rows.length === 0
            ) {

                return res.status(401).json({

                    error:
                        "Invalid username or password"

                });

            }

            const user =
                result.rows[0];

            // -------------------------------------------------
            // Check password
            // -------------------------------------------------

            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password_hash
                );

            if (!passwordMatch) {

                return res.status(401).json({

                    error:
                        "Invalid username or password"

                });

            }

            // -------------------------------------------------
            // Create JWT
            // -------------------------------------------------

            const token =
                jwt.sign(

                    {
                        user_id:
                            user.id,

                        username:
                            user.username,

                        role:
                            user.role,

                        employee_id:
                            user.employee_id
                    },

                    JWT_SECRET,

                    {
                        expiresIn:
                            "8h"
                    }

                );

            // -------------------------------------------------
            // Response
            // -------------------------------------------------

            res.json({

                message:
                    "Login successful",

                user: {

                    id:
                        user.id,

                    username:
                        user.username,

                    role:
                        user.role,

                    employee_id:
                        user.employee_id

                },

                token:
                    token

            });

        } catch (error) {

            console.error(
                "Login Error:",
                error
            );

            res.status(500).json({

                error:
                    "Login failed"

            });

        }

    }
);
// =====================================================
// CHANGE PASSWORD
// =====================================================
app.post(
    "/auth/change-password",
    authenticateToken,
    async (req, res) => {
        try {
            const { oldPassword, newPassword } = req.body;
            if (!oldPassword || !newPassword) {
                return res.status(400).json({
                    error: "Old password and new password are required"
                });
            }

            const result = await db.query(
                "SELECT id, password_hash FROM users WHERE id = $1",
                [req.user.user_id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: "User not found"
                });
            }

            const user = result.rows[0];

            const passwordMatch = await bcrypt.compare(oldPassword, user.password_hash);
            if (!passwordMatch) {
                return res.status(400).json({
                    error: "Incorrect old password"
                });
            }

            const saltRounds = 10;
            const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

            await db.query(
                "UPDATE users SET password_hash = $1 WHERE id = $2",
                [newPasswordHash, user.id]
            );

            res.json({
                message: "Password changed successfully"
            });

        } catch (error) {
            console.error("Change Password Error:", error);
            res.status(500).json({
                error: "Failed to change password"
            });
        }
    }
);

// =====================================================
// SUPABASE GO-TRUE OTP AUTHENTICATION
// =====================================================

// =====================================================
// SEND OTP (GMAIL LOG-IN START)
// =====================================================
app.post(
    "/auth/send-otp",
    async (req, res) => {
        try {
            const { email } = req.body;

            if (!email || !email.includes("@")) {
                return res.status(400).json({
                    error: "A valid email address is required"
                });
            }

            // Check if email exists in users table (covers admin and employees with user accounts)
            const userCheck = await db.query(
                "SELECT id FROM users WHERE LOWER(email) = LOWER($1)",
                [email.toLowerCase()]
            );

            if (userCheck.rows.length === 0) {
                // Check if email exists in employees table (covers newly imported employees without user records yet)
                const employeeCheck = await db.query(
                    "SELECT id FROM employees WHERE LOWER(email) = LOWER($1)",
                    [email.toLowerCase()]
                );

                if (employeeCheck.rows.length === 0) {
                    return res.status(404).json({
                        error: "This email is not registered. Please contact your admin to register."
                    });
                }
            }

            const supabaseUrl = process.env.SUPABASE_URL || "https://tjolsfsmrynallrzzugd.supabase.co";
            const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

            if (!supabaseAnonKey) {
                console.error("SUPABASE_ANON_KEY is missing from backend env variables.");
                return res.status(500).json({
                    error: "Supabase configuration is missing. Please add SUPABASE_ANON_KEY to your env."
                });
            }

            const response = await fetch(`${supabaseUrl}/auth/v1/otp`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    create_user: true
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Supabase OTP send failure:", data);
                return res.status(response.status).json({
                    error: data.msg || data.error_description || "Failed to trigger OTP from Supabase Auth"
                });
            }

            res.json({
                message: "OTP sent successfully via Supabase Auth"
            });

        } catch (error) {
            console.error("Send OTP Error:", error);
            res.status(500).json({ error: "Failed to send OTP" });
        }
    }
);

// =====================================================
// VERIFY OTP & LOGIN (GMAIL LOG-IN VERIFICATION)
// =====================================================
app.post(
    "/auth/verify-otp",
    async (req, res) => {
        try {
            const { email, otp } = req.body;

            if (!email || !otp) {
                return res.status(400).json({
                    error: "Email and OTP are required"
                });
            }

            const supabaseUrl = process.env.SUPABASE_URL || "https://tjolsfsmrynallrzzugd.supabase.co";
            const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

            if (!supabaseAnonKey) {
                return res.status(500).json({
                    error: "Supabase configuration is missing. Please add SUPABASE_ANON_KEY to your env."
                });
            }

            const response = await fetch(`${supabaseUrl}/auth/v1/verify`, {
                method: 'POST',
                headers: {
                    'apikey': supabaseAnonKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    email: email,
                    token: otp,
                    type: 'email'
                })
            });

            const data = await response.json();

            if (!response.ok) {
                console.error("Supabase OTP verify failure:", data);
                return res.status(response.status).json({
                    error: data.msg || data.error_description || "Incorrect OTP code. Please try again."
                });
            }

            // Search for user in users table by email
            let result = await db.query(
                "SELECT id, username, role, employee_id FROM users WHERE LOWER(email) = LOWER($1)",
                [email.toLowerCase()]
            );

            let user;

            if (result.rows.length === 0) {
                let username = email.split("@")[0].toLowerCase();
                
                // Fallback check: if this email is for the admin (by username prefix or matching admin.user@gmail.com)
                if (username === "admin") {
                    const dummyPasswordHash = await bcrypt.hash("google_dummy_password_123!", 10);
                    const adminUserResult = await db.query(
                        "INSERT INTO users (username, password_hash, role, email) VALUES ($1, $2, $3, $4) RETURNING id, username, role, employee_id",
                        ["admin", dummyPasswordHash, "admin", email.toLowerCase()]
                    );
                    user = adminUserResult.rows[0];
                } else {
                    // Check if employee exists with this email
                    const empResult = await db.query(
                        "SELECT id, name FROM employees WHERE LOWER(email) = LOWER($1)",
                        [email.toLowerCase()]
                    );

                    if (empResult.rows.length === 0) {
                        return res.status(404).json({
                            error: "Employee record not found for this email"
                        });
                    }

                    const employee = empResult.rows[0];
                    const dummyPasswordHash = await bcrypt.hash("google_dummy_password_123!", 10);
                    
                    const newUserResult = await db.query(
                        "INSERT INTO users (username, password_hash, role, employee_id, email) VALUES ($1, $2, $3, $4, $5) RETURNING id, username, role, employee_id",
                        [username, dummyPasswordHash, "employee", employee.id, email.toLowerCase()]
                    );
                    user = newUserResult.rows[0];
                }
            } else {
                user = result.rows[0];
            }

            const token = jwt.sign(
                {
                    user_id: user.id,
                    username: user.username,
                    role: user.role,
                    employee_id: user.employee_id
                },
                JWT_SECRET,
                { expiresIn: "8h" }
            );

            res.json({
                message: "Gmail verification successful",
                user: {
                    id: user.id,
                    username: user.username,
                    role: user.role,
                    employee_id: user.employee_id
                },
                token: token
            });

        } catch (error) {
            console.error("Verify OTP Error:", error);
            res.status(500).json({ error: "Failed to verify OTP" });
        }
    }
);

// =====================================================
// eSSL ATTENDANCE INTEGRATION
// TEST VERSION
// =====================================================
app.post(
    "/api/essl/attendance",
    async (req, res) => {

        try {

            const {
                device_code,
                user_id,
                timestamp,
                punch_type
            } = req.body;

            // -------------------------------------------------
            // Validate request
            // -------------------------------------------------

            if (
                !device_code ||
                !user_id ||
                !timestamp
            ) {

                return res.status(400).json({

                    error:
                        "device_code, user_id and timestamp are required"

                });

            }

            // -------------------------------------------------
            // Find eSSL device
            // -------------------------------------------------

            const deviceResult =
                await db.query(

                    `SELECT
                        id,
                        device_code,
                        device_name,
                        model,
                        status

                     FROM essl_devices

                     WHERE device_code = $1`,

                    [device_code]

                );

            if (
                deviceResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "eSSL device not registered"

                });

            }

            const device =
                deviceResult.rows[0];

            // -------------------------------------------------
            // Check device status
            // -------------------------------------------------

            if (
                device.status !== "active"
            ) {

                return res.status(403).json({

                    error:
                        "eSSL device is inactive"

                });

            }

            // -------------------------------------------------
            // Find employee mapping
            // -------------------------------------------------

            const mappingResult =
                await db.query(

                    `SELECT
                        m.id,
                        m.essl_user_id,
                        m.employee_id,

                        e.employee_code,
                        e.name

                     FROM essl_employee_mapping m

                     INNER JOIN employees e
                     ON e.id = m.employee_id

                     WHERE
                        m.device_id = $1
                     AND
                        m.essl_user_id = $2`,

                    [
                        device.id,
                        String(user_id)
                    ]

                );

            if (
                mappingResult.rows.length === 0
            ) {

                return res.status(404).json({

                    error:
                        "eSSL user is not mapped to an employee"

                });

            }

            const mapping =
                mappingResult.rows[0];

            // -------------------------------------------------
            // Save raw eSSL transaction
            // -------------------------------------------------

            const logResult =
                await db.query(

                    `INSERT INTO essl_attendance_logs
                    (
                        device_id,
                        essl_user_id,
                        transaction_time,
                        punch_type,
                        raw_data
                    )

                    VALUES
                    (
                        $1,
                        $2,
                        $3,
                        $4,
                        $5
                    )

                    ON CONFLICT
                    (
                        device_id,
                        essl_user_id,
                        transaction_time
                    )

                    DO NOTHING

                    RETURNING id`,

                    [
                        device.id,
                        String(user_id),
                        timestamp,
                        punch_type || null,
                        req.body
                    ]

                );

        
                  // -------------------------------------------------
                  // Duplicate transaction
                  // -------------------------------------------------

                      const isDuplicateTransaction =
                      logResult.rows.length === 0;

                      if (
                     isDuplicateTransaction
                ) {

            console.log(
         "Duplicate eSSL transaction detected. Continuing attendance processing."
    );

}
            // -------------------------------------------------
            // Convert timestamp to attendance date
            // -------------------------------------------------

            const attendanceDate =
                timestamp.substring(0, 10);

            // -------------------------------------------------
            // Normalize punch type
            // -------------------------------------------------

            const punchType =
                String(punch_type || "IN")
                    .trim()
                    .toUpperCase();

            // -------------------------------------------------
            // CHECK-IN
            // -------------------------------------------------

            if (
                punchType === "IN"
            ) {

                const existingAttendance =
                    await db.query(

                        `SELECT
                            id,
                            check_in,
                            check_out,
                            status

                         FROM attendance

                         WHERE
                            employee_id = $1
                         AND
                            attendance_date = $2

                         LIMIT 1`,

                        [
                            mapping.employee_id,
                            attendanceDate
                        ]

                    );

                if (
                    existingAttendance.rows.length === 0
                ) {

                    await db.query(

                        `INSERT INTO attendance
                        (
                            employee_id,
                            attendance_date,
                            check_in,
                            check_out,
                            status
                        )

                        VALUES
                        (
                            $1,
                            $2,
                            $3,
                            NULL,
                            'Present'
                        )`,

                        [
                            mapping.employee_id,
                            attendanceDate,
                            timestamp
                        ]

                    );

                } else {

                    const attendance =
                        existingAttendance.rows[0];

                    // Only set check-in if one doesn't already exist
                    if (
                        !attendance.check_in
                    ) {

                        await db.query(

                            `UPDATE attendance

                             SET
                                check_in = $1,
                                status = 'Present'

                             WHERE id = $2`,

                            [
                                timestamp,
                                attendance.id
                            ]

                        );

                    }

                }

            }

            // -------------------------------------------------
            // CHECK-OUT
            // -------------------------------------------------

            else if (
                punchType === "OUT"
            ) {

                const existingAttendance =
                    await db.query(

                        `SELECT
                            id,
                            check_in,
                            check_out

                         FROM attendance

                         WHERE
                            employee_id = $1
                         AND
                            attendance_date = $2

                         LIMIT 1`,

                        [
                            mapping.employee_id,
                            attendanceDate
                        ]

                    );

                if (
                    existingAttendance.rows.length === 0
                ) {

                    return res.status(400).json({

                        error:
                            "Cannot check out because check-in attendance record does not exist",

                        employee: {

                            employee_code:
                                mapping.employee_code,

                            name:
                                mapping.name

                        }

                    });

                }

                const attendance =
                    existingAttendance.rows[0];

                await db.query(

                    `UPDATE attendance

                     SET
                        check_out = $1,
                        status = 'Present'

                     WHERE id = $2`,

                    [
                        timestamp,
                        attendance.id
                    ]

                );

            }

            // -------------------------------------------------
            // Invalid punch type
            // -------------------------------------------------

            else {

                return res.status(400).json({

                    error:
                        "Invalid punch_type. Use IN or OUT."

                });

            }

            // -------------------------------------------------
            // Get final attendance record
            // -------------------------------------------------

            const attendanceResult =
                await db.query(

                    `SELECT
                        id,
                        employee_id,
                        attendance_date,
                        check_in,
                        check_out,
                        status

                     FROM attendance

                     WHERE
                        employee_id = $1
                     AND
                        attendance_date = $2

                     LIMIT 1`,

                    [
                        mapping.employee_id,
                        attendanceDate
                    ]

                );

            // -------------------------------------------------
            // Success response
            // -------------------------------------------------

            res.status(201).json({

                message:
                    "eSSL attendance processed successfully",

                device: {

                    device_code:
                        device.device_code,

                    model:
                        device.model

                },

                employee: {

                    employee_id:
                        mapping.employee_id,

                    employee_code:
                        mapping.employee_code,

                    name:
                        mapping.name

                },

                attendance:
                    attendanceResult.rows[0]

            });

        } catch (error) {

            console.error(
                "eSSL Attendance Error:",
                error
            );

            res.status(500).json({

                error:
                    "Failed to process eSSL attendance"

            });

        }

    }
);
// =====================================================

// =====================================================
// GET eSSL EMPLOYEE MAPPINGS
// ADMIN ONLY
// =====================================================

app.get(
    "/api/essl/mappings",
    authenticateToken,
    requireRole("admin"),
    async (req, res) => {

        try {

            const result =
                await db.query(
                    `
                    SELECT
                        m.id,
                        m.device_id,
                        d.device_code,
                        d.device_name,
                        d.model,
                        m.essl_user_id,
                        m.employee_id,
                        e.employee_code,
                        e.name,
                        e.department,
                        e.designation,
                        e.mobile,
                        e.status
                    FROM essl_employee_mapping m

                    INNER JOIN essl_devices d
                        ON d.id = m.device_id

                    INNER JOIN employees e
                        ON e.id = m.employee_id

                    ORDER BY m.id
                    `
                );

            return res.json({
                count: result.rows.length,
                mappings: result.rows
            });

        } catch (error) {

            console.error(
                "Get eSSL Mappings Error:",
                error
            );

            return res.status(500).json({
                error: "Failed to fetch eSSL employee mappings"
            });

        }

    }
);

// START SERVER
// =====================================================

app.listen(
    PORT,
    () => {

        console.log(
            `Server running at http://localhost:${PORT}`
        );

    }
);








