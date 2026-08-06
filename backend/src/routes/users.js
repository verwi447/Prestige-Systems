import express from "express";
import bcrypt from "bcryptjs";
import { db } from "../db.js";
import { auth } from "../middleware/auth.js";
import { loadCurrentUser, PERMISSIONS, requireRole } from "../middleware/access.js";
import { writeAuditLog } from "../utils/auditLog.js";

const router = express.Router();
const clientEmployeePermissionKeys = new Set(PERMISSIONS.filter((key) => key !== "MANAGE_EMPLOYEES"));

// Change user password
router.put("/change-password", auth, async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
        return res.status(400).json({ error: "Stare i nowe hasło są wymagane." });
    }

    if (typeof newPassword !== "string" || newPassword.length < 12 || newPassword.length > 128) {
        return res.status(400).json({ error: "Nowe hasło musi mieć od 12 do 128 znaków." });
    }

    try {
        const userResult = await db.query("SELECT COALESCE(password_hash, password) AS password_hash FROM users WHERE id = $1", [userId]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "Użytkownik nie znaleziony." });
        }

        const user = userResult.rows[0];
        const isMatch = await bcrypt.compare(oldPassword, user.password_hash);

        if (!isMatch) {
            return res.status(401).json({ error: "Nieprawidłowe stare hasło." });
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query("UPDATE users SET password = $1, password_hash = $1, password_changed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = $2", [hashedPassword, userId]);

        res.json({ message: "Hasło zostało pomyślnie zmienione." });

    } catch (err) {
        console.error("Błąd przy zmianie hasła:", err);
        res.status(500).json({ error: "Błąd serwera podczas zmiany hasła." });
    }
});

router.put("/:userId/permissions", auth, loadCurrentUser, requireRole("ADMIN", "CLIENT_OWNER"), async (req, res) => {
    const { permissions = [] } = req.body;

    const target = await db.query("SELECT id, company_id, role FROM users WHERE id=$1", [req.params.userId]);
    if (!target.rows[0]) return res.status(404).json({ error: "Użytkownik nie znaleziony." });
    if (req.currentUser.role !== "ADMIN" && Number(target.rows[0].company_id) !== Number(req.currentUser.company_id)) {
        return res.status(403).json({ error: "Brak dostępu do tego użytkownika." });
    }
    if (target.rows[0].role !== "CLIENT_EMPLOYEE") {
        return res.status(400).json({ error: "Uprawnienia mozna zmieniac wylacznie pracownikom klienta." });
    }

    const normalized = Array.isArray(permissions)
        ? permissions
        : Object.entries(permissions).map(([permissionKey, enabled]) => ({ permissionKey, enabled }));

    const requestedPermissionKeys = normalized.map((permission) => permission.permissionKey || permission.key).filter(Boolean);
    if (requestedPermissionKeys.some((permissionKey) => !clientEmployeePermissionKeys.has(permissionKey))) {
        return res.status(400).json({ error: "Wybrano niedozwolone uprawnienie pracownika." });
    }

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        for (const permission of normalized) {
            const permissionKey = permission.permissionKey || permission.key;
            await client.query(
                `INSERT INTO user_permissions (user_id, permission_key, enabled)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, permission_key)
                 DO UPDATE SET enabled=EXCLUDED.enabled`,
                [req.params.userId, permissionKey, permission.enabled !== false]
            );
        }
        await client.query("COMMIT");
        const result = await db.query(
            "SELECT permission_key, enabled FROM user_permissions WHERE user_id=$1 ORDER BY permission_key",
            [req.params.userId]
        );
        await writeAuditLog({
            category: "USER",
            action: "USER_PERMISSIONS_UPDATED",
            userId: req.currentUser.id,
            companyId: target.rows[0].company_id,
            entityType: "user",
            entityId: req.params.userId,
            message: "Zmieniono uprawnienia pracownika klienta.",
            metadata: { permissions: result.rows.map((row) => row.permission_key) }
        }).catch((error) => console.error("Global audit log failed:", error));
        res.json(result.rows);
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Wewnętrzny błąd serwera." });
    } finally {
        client.release();
    }
});

router.put("/:userId/sites", auth, loadCurrentUser, requireRole("ADMIN", "CLIENT_OWNER"), async (req, res) => {
    const siteIds = req.body.siteIds || req.body.sites || [];
    const target = await db.query("SELECT id, company_id, role FROM users WHERE id=$1", [req.params.userId]);
    if (!target.rows[0]) return res.status(404).json({ error: "Użytkownik nie znaleziony." });
    if (target.rows[0].role !== "CLIENT_EMPLOYEE") {
        return res.status(400).json({ error: "Przypisania obiektów dotyczą pracowników klienta." });
    }
    if (req.currentUser.role !== "ADMIN" && Number(target.rows[0].company_id) !== Number(req.currentUser.company_id)) {
        return res.status(403).json({ error: "Brak dostępu do tego użytkownika." });
    }

    const sites = await db.query(
        "SELECT id FROM objects WHERE company_id=$1 AND id = ANY($2::int[])",
        [target.rows[0].company_id, siteIds]
    );
    if (sites.rows.length !== siteIds.length) {
        return res.status(400).json({ error: "Co najmniej jeden obiekt nie należy do firmy użytkownika." });
    }

    const client = await db.connect();
    try {
        await client.query("BEGIN");
        await client.query("DELETE FROM user_site_access WHERE user_id=$1", [req.params.userId]);
        for (const siteId of siteIds) {
            await client.query(
                "INSERT INTO user_site_access (user_id, site_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                [req.params.userId, siteId]
            );
        }
        await client.query("COMMIT");
        const result = await db.query(
            `SELECT o.id, o.name
             FROM user_site_access usa
             JOIN objects o ON o.id=usa.site_id
             WHERE usa.user_id=$1
             ORDER BY o.name`,
            [req.params.userId]
        );
        res.json(result.rows);
    } catch (err) {
        await client.query("ROLLBACK");
        res.status(500).json({ error: "Wewnętrzny błąd serwera." });
    } finally {
        client.release();
    }
});

export default router;
