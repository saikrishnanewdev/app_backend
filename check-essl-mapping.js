const db = require("./db");

(async () => {
    try {
        const result = await db.query(`
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = 'essl_employee_mapping'
            ORDER BY ordinal_position
        `);

        console.table(result.rows);
    } catch (error) {
        console.error(error);
    } finally {
        await db.end();
    }
})();
