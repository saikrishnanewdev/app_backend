const db = require("./db");

(async () => {
    try {
        const result = await db.query(`
            SELECT
                id,
                device_code,
                device_name,
                model,
                ip_address,
                tcp_port,
                status
            FROM essl_devices
            ORDER BY id
        `);

        console.table(result.rows);
    } catch (error) {
        console.error(error);
    } finally {
        await db.end();
    }
})();
