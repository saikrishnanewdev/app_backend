const db = require("./db");

async function inspect() {
    try {
        console.log("\n=== eSSL DEVICES ===");

        const devices = await db.query(`
            SELECT *
            FROM essl_devices
            ORDER BY id
        `);

        console.table(devices.rows);

        console.log("\n=== eSSL EMPLOYEE MAPPINGS ===");

        const mappings = await db.query(`
            SELECT *
            FROM essl_employee_mapping
            ORDER BY id
        `);

        console.table(mappings.rows);

    } catch (error) {
        console.error("Database inspection failed:");
        console.error(error);
    } finally {
        await db.end();
    }
}

inspect();
