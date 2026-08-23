import { db } from "./db.js";
import { getAppInfo } from "./appInfo.js";
import { ADD_AI_ASSISTANT_SETTINGS_MIGRATION, ADD_AI_EQUIPMENT_TYPES_MIGRATION, ADD_AI_KNOWLEDGE_BASE_MIGRATION, ADD_AI_KNOWLEDGE_FILES_MIGRATION, ADD_AI_KNOWLEDGE_SOLUTION_MIGRATION, ADD_AI_TICKET_COMMENT_MIGRATION, ADD_PASSWORD_CHANGED_AT_MIGRATION, LEGACY_SCHEMA_MIGRATION, CURRENT_SCHEMA_VERSION } from "./migrationPlan.js";
import { getVersionedMigrationStatus, runVersionedMigrations } from "./migrationRunner.js";

export async function runLegacySchemaMigration() {
  const client = await db.connect();
  
  try {
    console.log("Starting database migration...");

    // Create tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT DEFAULT 'USER',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ users table");

    await client.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS company_id INT,
      ADD COLUMN IF NOT EXISTS first_name TEXT,
      ADD COLUMN IF NOT EXISTS last_name TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    await client.query(`
      UPDATE users
      SET
        role = CASE WHEN role = 'USER' THEN 'CLIENT_EMPLOYEE' ELSE role END,
        first_name = COALESCE(first_name, username, ''),
        last_name = COALESCE(last_name, ''),
        email = COALESCE(email, username),
        password_hash = COALESCE(password_hash, password),
        is_active = COALESCE(is_active, TRUE)
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS own_company (
        id SERIAL PRIMARY KEY,
        logo_url TEXT,
        name TEXT NOT NULL,
        nip TEXT,
        regon TEXT,
        address TEXT,
        email TEXT,
        phone TEXT,
        website TEXT,
        additional_info TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE own_company
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS additional_info TEXT;
    `);
    await client.query(`
      INSERT INTO own_company (name)
      SELECT 'Prestige Systems'
      WHERE NOT EXISTS (SELECT 1 FROM own_company);
    `);
    console.log("users and own_company access columns ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        enabled BOOLEAN DEFAULT FALSE,
        frequency TEXT DEFAULT 'DAILY',
        time_of_day TEXT DEFAULT '02:30',
        retention_count INT DEFAULT 10,
        include_database BOOLEAN DEFAULT TRUE,
        include_uploads BOOLEAN DEFAULT TRUE,
        include_pdf BOOLEAN DEFAULT TRUE,
        include_config BOOLEAN DEFAULT TRUE,
        encryption_enabled BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO backup_settings (id)
      SELECT 'default'
      WHERE NOT EXISTS (SELECT 1 FROM backup_settings WHERE id='default');
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_locations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'LOCAL_FOLDER',
        path TEXT NOT NULL,
        is_default BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'OFFLINE',
        free_space_bytes BIGINT,
        last_test_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_jobs (
        id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'MANUAL',
        status TEXT DEFAULT 'PENDING',
        integrity_status TEXT DEFAULT 'NOT_CHECKED',
        test_restore_status TEXT DEFAULT 'NOT_TESTED',
        file_path TEXT,
        file_name TEXT,
        size_bytes BIGINT,
        location_id TEXT REFERENCES backup_locations(id) ON DELETE SET NULL,
        created_by_id INT REFERENCES users(id) ON DELETE SET NULL,
        error_message TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS backup_audit (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        backup_job_id TEXT REFERENCES backup_jobs(id) ON DELETE SET NULL,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        ip_address TEXT,
        status TEXT DEFAULT 'SUCCESS',
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("backup tables ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        type TEXT NOT NULL,
        priority TEXT DEFAULT 'INFO',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        entity_type TEXT,
        entity_id TEXT,
        link TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_created
      ON notifications (user_id, created_at DESC);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
      ON notifications (user_id, is_read, priority);
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        category TEXT NOT NULL,
        in_app_enabled BOOLEAN DEFAULT TRUE,
        email_enabled BOOLEAN DEFAULT FALSE,
        push_enabled BOOLEAN DEFAULT FALSE,
        sound_enabled BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, category)
      );
    `);
    console.log("notification tables ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS account_notification_preferences (
        user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        in_app BOOLEAN DEFAULT TRUE,
        email BOOLEAN DEFAULT FALSE,
        offers BOOLEAN DEFAULT TRUE,
        tickets BOOLEAN DEFAULT TRUE,
        comments BOOLEAN DEFAULT TRUE,
        system BOOLEAN DEFAULT TRUE,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    const notificationScopeTables = await client.query(`
      SELECT
        to_regclass('public.offers') AS offers,
        to_regclass('public.tickets') AS tickets,
        to_regclass('public.customers') AS customers
    `);
    if (Object.values(notificationScopeTables.rows[0]).every(Boolean)) {
      await client.query(`
        DELETE FROM notifications n
        USING users u
        WHERE n.user_id=u.id
          AND u.role <> 'ADMIN'
          AND (
            n.category NOT IN ('OFFERS', 'TICKETS')
            OR n.entity_id !~ '^[0-9]+$'
            OR (n.category='OFFERS' AND NOT EXISTS (
              SELECT 1 FROM offers o
              JOIN customers c ON c.id=o.customer_id
              WHERE o.id=CASE WHEN n.entity_id ~ '^[0-9]+$' THEN n.entity_id::int END AND c.company_id=u.company_id
            ))
            OR (n.category='TICKETS' AND NOT EXISTS (
              SELECT 1 FROM tickets t
              JOIN customers c ON c.id=t.customer_id
              WHERE t.id=CASE WHEN n.entity_id ~ '^[0-9]+$' THEN n.entity_id::int END AND c.company_id=u.company_id
            ))
          );
      `);
    }
    await client.query(`
      DELETE FROM notification_preferences np
      USING users u
      WHERE np.user_id=u.id
        AND u.role <> 'ADMIN'
        AND np.category NOT IN ('OFFERS', 'TICKETS');
    `);
    await client.query(`
      UPDATE account_notification_preferences anp
      SET system=FALSE, updated_at=CURRENT_TIMESTAMP
      FROM users u
      WHERE anp.user_id=u.id AND u.role <> 'ADMIN';
    `);
    console.log("account notification preferences ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS email_settings (
        id TEXT PRIMARY KEY,
        smtp_host TEXT NOT NULL,
        smtp_port INT NOT NULL,
        smtp_secure BOOLEAN DEFAULT FALSE,
        smtp_user TEXT,
        smtp_password_enc TEXT,
        from_email TEXT NOT NULL,
        from_name TEXT,
        reply_to_email TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        last_test_status TEXT,
        last_test_message TEXT,
        last_test_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE email_settings
      ADD COLUMN IF NOT EXISTS footer_enabled BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS footer_html TEXT,
      ADD COLUMN IF NOT EXISTS footer_logo_url TEXT;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        body_text TEXT,
        variables JSONB,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_footer_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        footer_enabled BOOLEAN DEFAULT TRUE,
        footer_html TEXT,
        footer_logo_url TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO email_footer_settings (id, footer_enabled, footer_html)
      SELECT 'default', TRUE, '<p><strong>Prestige Systems</strong><br />www.prestigesystems.pl</p>'
      WHERE NOT EXISTS (SELECT 1 FROM email_footer_settings WHERE id='default');
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS email_logs (
        id TEXT PRIMARY KEY,
        template_key TEXT,
        subject TEXT NOT NULL,
        to_email TEXT NOT NULL,
        to_name TEXT,
        from_email TEXT,
        entity_type TEXT,
        entity_id TEXT,
        status TEXT DEFAULT 'PENDING',
        error_message TEXT,
        sent_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_by_id INT REFERENCES users(id) ON DELETE SET NULL
      );
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_email_logs_created
      ON email_logs (created_at DESC);
    `);
    await client.query(`
      INSERT INTO email_templates (id, key, name, subject, body_html, body_text, variables)
      VALUES
        ('email-template-offer-send','OFFER_SEND','Wysyłka oferty','Oferta {{offerNumber}} - {{offerTitle}}',
         '<p>Dzień dobry,</p><p>W załączniku przesyłamy ofertę handlową <strong>{{offerNumber}}</strong> dotyczącą:</p><p><strong>{{offerTitle}}</strong></p><p>W razie pytań pozostajemy do dyspozycji.</p><p>Pozdrawiamy,<br/>Prestige Systems</p>',
         'Dzień dobry, w załączniku przesyłamy ofertę {{offerNumber}} dotyczącą: {{offerTitle}}.', '{}'::jsonb),
        ('email-template-offer-reminder','OFFER_REMINDER','Przypomnienie o ofercie','Przypomnienie o ofercie {{offerNumber}}',
         '<p>Dzień dobry,</p><p>Przypominamy o ofercie <strong>{{offerNumber}}</strong>.</p><p>W razie pytań pozostajemy do dyspozycji.</p>',
         'Przypominamy o ofercie {{offerNumber}}.', '{}'::jsonb),
        ('email-template-ticket-created','TICKET_CREATED','Potwierdzenie zgłoszenia','Przyjęliśmy zgłoszenie {{ticketNumber}}',
         '<p>Dzień dobry,</p><p>Przyjęliśmy zgłoszenie <strong>{{ticketNumber}}</strong>.</p><p>Tytuł: {{ticketTitle}}</p>',
         'Przyjęliśmy zgłoszenie {{ticketNumber}}: {{ticketTitle}}.', '{}'::jsonb),
        ('email-template-ticket-status','TICKET_STATUS_CHANGED','Zmiana statusu zgłoszenia','Status zgłoszenia {{ticketNumber}} został zmieniony',
         '<p>Dzień dobry,</p><p>Status zgłoszenia <strong>{{ticketNumber}}</strong> został zmieniony.</p>',
         'Status zgłoszenia {{ticketNumber}} został zmieniony.', '{}'::jsonb),
        ('email-template-backup-failed','BACKUP_FAILED','Błąd backupu systemu','Prestige Systems HUB - backup nie powiódł się',
         '<p>Backup systemu nie powiódł się.</p><p>Błąd: {{errorMessage}}</p>',
         'Backup systemu nie powiódł się. Błąd: {{errorMessage}}.', '{}'::jsonb)
      ON CONFLICT (key) DO NOTHING;
    `);
    console.log("email tables ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ companies table");

    await client.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS nip TEXT,
      ADD COLUMN IF NOT EXISTS regon TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS postal_code TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS contact_person TEXT,
      ADD COLUMN IF NOT EXISTS phone TEXT,
      ADD COLUMN IF NOT EXISTS email TEXT,
      ADD COLUMN IF NOT EXISTS website TEXT,
      ADD COLUMN IF NOT EXISTS bank_account TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS is_own_company BOOLEAN DEFAULT FALSE;
    `);
    await client.query(`
      INSERT INTO companies (
        name, description, address, city, country, email, website, is_own_company
      )
      SELECT 'Prestige Systems', 'Dane naszej firmy używane w ofertach', '', '', 'Polska', '', '', TRUE
      WHERE NOT EXISTS (SELECT 1 FROM companies WHERE is_own_company = TRUE);
    `);
    console.log("companies commercial columns ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        company_id INT REFERENCES companies(id),
        company_role TEXT DEFAULT 'PRACOWNIK',
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ customers table");

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id);
    `);
    console.log("✓ customers company_id column ensured");

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS company_role TEXT DEFAULT 'PRACOWNIK';
    `);
    console.log("customers company_role column ensured");

    await client.query(`
      ALTER TABLE customers
      ADD COLUMN IF NOT EXISTS nip TEXT,
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS postal_code TEXT,
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT,
      ADD COLUMN IF NOT EXISTS contact_person TEXT,
      ADD COLUMN IF NOT EXISTS user_id INT UNIQUE REFERENCES users(id) ON DELETE SET NULL;
    `);
    console.log("customers commercial columns ensured");

    await client.query(`
      INSERT INTO customers (
        name, email, phone, company_id, company_role, created_by,
        nip, address, postal_code, city, country, contact_person
      )
      SELECT
        co.name, co.email, co.phone, co.id, 'PRIMARY_CONTACT', co.created_by,
        co.nip, co.address, co.postal_code, co.city, co.country, NULL
      FROM companies co
      WHERE COALESCE(co.is_own_company, FALSE)=FALSE
        AND COALESCE(co.is_active, TRUE)=TRUE
        AND NOT EXISTS (
          SELECT 1
          FROM customers c
          WHERE c.company_id=co.id
        );
    `);
    console.log("primary customer contacts ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS objects (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        company_id INT REFERENCES companies(id),
        customer_id INT REFERENCES customers(id),
        status TEXT DEFAULT 'NOWY',
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ objects table");
    await client.query(`
      ALTER TABLE objects
      ADD COLUMN IF NOT EXISTS company_id INT REFERENCES companies(id),
      ADD COLUMN IF NOT EXISTS address TEXT,
      ADD COLUMN IF NOT EXISTS postal_code TEXT,
      ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Polska',
      ADD COLUMN IF NOT EXISTS city TEXT,
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    console.log("objects company_id column ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_site_access (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        site_id INT NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, site_id)
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_permissions (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        permission_key TEXT NOT NULL,
        enabled BOOLEAN DEFAULT TRUE,
        UNIQUE(user_id, permission_key)
      );
    `);
    console.log("user access tables ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        catalog_price DECIMAL(10, 2) DEFAULT 0,
        sale_price DECIMAL(10, 2) DEFAULT 0,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("products table");

    await client.query(`
      CREATE TABLE IF NOT EXISTS article_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        slug TEXT NOT NULL UNIQUE,
        description TEXT,
        sort_order INT DEFAULT 0,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      INSERT INTO article_categories (name, slug, description, sort_order)
      VALUES
        ('Bilety', 'bilety', 'Materiały eksploatacyjne i bilety do urządzeń.', 1),
        ('Części zamienne', 'czesci-zamienne', 'Elementy serwisowe, podzespoły i akcesoria.', 2),
        ('Urządzenia', 'urzadzenia', 'Urządzenia i sprzęt wykorzystywany w rozwiązaniach.', 3),
        ('Usługi', 'uslugi', 'Usługi wdrożeniowe, serwisowe i utrzymaniowe.', 4),
        ('Inne', 'inne', 'Pozostałe pozycje katalogowe.', 5)
      ON CONFLICT (slug) DO UPDATE SET
        name=EXCLUDED.name,
        description=EXCLUDED.description,
        sort_order=EXCLUDED.sort_order,
        updated_at=CURRENT_TIMESTAMP;
    `);
    console.log("article categories ensured");

    await client.query(`
      ALTER TABLE products
      ADD COLUMN IF NOT EXISTS category_id INT REFERENCES article_categories(id),
      ADD COLUMN IF NOT EXISTS image_url TEXT,
      ADD COLUMN IF NOT EXISTS code TEXT,
      ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'szt.',
      ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5, 2) DEFAULT 23,
      ADD COLUMN IF NOT EXISTS visible_for_clients BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS show_price_to_client BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    await client.query(`
      UPDATE products
      SET category_id = COALESCE(
        category_id,
        (SELECT id FROM article_categories WHERE slug='inne' LIMIT 1)
      ),
      active = COALESCE(active, TRUE),
      visible_for_clients = COALESCE(visible_for_clients, FALSE),
      show_price_to_client = COALESCE(show_price_to_client, FALSE),
      vat_rate = COALESCE(vat_rate, 23),
      unit = COALESCE(unit, 'szt.')
    `);
    console.log("products offer columns ensured");

    await client.query(`
      ALTER TABLE products
      DROP COLUMN IF EXISTS product_index;
    `);
    console.log("products product_index column dropped");

    await client.query(`
      ALTER TABLE IF EXISTS offer_items
      DROP COLUMN IF EXISTS product_index;
    `);
    console.log("offer_items product_index column dropped");

    await client.query(`
      ALTER TABLE IF EXISTS offer_items
      DROP COLUMN IF EXISTS discount;
    `);
    console.log("offer_items discount column dropped");

    await client.query(`
      CREATE TABLE IF NOT EXISTS tickets (
        id SERIAL PRIMARY KEY,
        ticket_number TEXT UNIQUE,
        type TEXT NOT NULL,
        subject TEXT NOT NULL,
        description TEXT,
        object_id INT REFERENCES objects(id) ON DELETE SET NULL,
        customer_id INT REFERENCES customers(id) ON DELETE SET NULL,
        created_by INT REFERENCES users(id),
        status TEXT DEFAULT 'NEW',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'NORMAL',
      ADD COLUMN IF NOT EXISTS blocks_work BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS contact_name TEXT,
      ADD COLUMN IF NOT EXISTS contact_phone TEXT,
      ADD COLUMN IF NOT EXISTS assigned_to_id INT REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS category TEXT,
      ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'Portal klienta',
      ADD COLUMN IF NOT EXISTS sla_due_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
    await client.query(`
      ALTER TABLE tickets
      DROP CONSTRAINT IF EXISTS tickets_status_check;
    `);
    await client.query(`
      UPDATE tickets
      SET status = CASE
        WHEN status IN ('NEW','ACCEPTED','IN_PROGRESS','WAITING_FOR_CLIENT','WAITING_FOR_PARTS','REJECTED','COMPLETED','CANCELLED') THEN status
        WHEN UPPER(COALESCE(status, '')) LIKE '%TRAKCIE%' THEN 'IN_PROGRESS'
        WHEN UPPER(COALESCE(status, '')) LIKE '%ODRZ%' THEN 'REJECTED'
        WHEN UPPER(COALESCE(status, '')) LIKE '%ZAKO%' THEN 'COMPLETED'
        WHEN UPPER(COALESCE(status, '')) LIKE '%ANUL%' THEN 'CANCELLED'
        WHEN UPPER(COALESCE(status, '')) LIKE '%CZES%' OR UPPER(COALESCE(status, '')) LIKE '%CZĘŚ%' THEN 'WAITING_FOR_PARTS'
        ELSE 'NEW'
      END,
      type = CASE
        WHEN type IN ('SYSTEM_FAILURE','HARDWARE_FAILURE','ORDER') THEN type
        WHEN UPPER(COALESCE(type, '')) LIKE '%ZAM%' THEN 'ORDER'
        WHEN UPPER(COALESCE(type, '')) LIKE '%SPRZ%' THEN 'HARDWARE_FAILURE'
        ELSE 'SYSTEM_FAILURE'
      END,
      priority = COALESCE(priority, 'NORMAL'),
      blocks_work = COALESCE(blocks_work, FALSE),
      updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP);
    `);
    await client.query(`
      ALTER TABLE tickets
      DROP CONSTRAINT IF EXISTS tickets_status_check;
    `);
    await client.query(`
      ALTER TABLE tickets
      ADD CONSTRAINT tickets_status_check
      CHECK (status IN ('NEW','ACCEPTED','IN_PROGRESS','WAITING_FOR_CLIENT','WAITING_FOR_PARTS','REJECTED','COMPLETED','CANCELLED'));
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_items (
        id SERIAL PRIMARY KEY,
        ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        code TEXT,
        producer TEXT,
        unit TEXT DEFAULT 'szt.',
        quantity DECIMAL(10, 2) NOT NULL DEFAULT 1,
        price_net DECIMAL(10, 2) DEFAULT 0,
        vat_rate DECIMAL(5, 2) DEFAULT 23,
        total_net DECIMAL(10, 2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_comments (
        id SERIAL PRIMARY KEY,
        ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        author_id INT REFERENCES users(id),
        content TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE ticket_comments
      ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE;
    `);
    await client.query("UPDATE ticket_comments SET is_internal=FALSE WHERE is_internal IS NULL");
    await client.query(`
      ALTER TABLE ticket_comments
      ALTER COLUMN is_internal SET DEFAULT FALSE,
      ALTER COLUMN is_internal SET NOT NULL;
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_photos (
        id SERIAL PRIMARY KEY,
        ticket_id INT REFERENCES tickets(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INT,
        uploaded_by INT REFERENCES users(id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      ALTER TABLE ticket_photos
      ADD COLUMN IF NOT EXISTS original_name TEXT,
      ADD COLUMN IF NOT EXISTS mime_type TEXT,
      ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'PUBLIC',
      ADD COLUMN IF NOT EXISTS ticket_comment_id INT REFERENCES ticket_comments(id) ON DELETE CASCADE;
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_ticket_photos_ticket_comment_id ON ticket_photos(ticket_comment_id)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_history (
        id SERIAL PRIMARY KEY,
        ticket_id INT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_audit_log (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'SUCCESS',
        user_id INT REFERENCES users(id) ON DELETE SET NULL,
        company_id INT REFERENCES companies(id) ON DELETE SET NULL,
        entity_type TEXT,
        entity_id TEXT,
        ip_address TEXT,
        message TEXT,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_audit_log_created_at ON system_audit_log (created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_audit_log_category_created_at ON system_audit_log (category, created_at DESC)");
    await client.query("CREATE INDEX IF NOT EXISTS idx_system_audit_log_user_created_at ON system_audit_log (user_id, created_at DESC)");
    await client.query(`
      INSERT INTO system_audit_log (id, category, action, status, user_id, entity_type, entity_id, metadata, created_at)
      SELECT
        'ticket-history-' || th.id,
        CASE WHEN t.type='ORDER' THEN 'ORDER' ELSE 'TICKET' END,
        th.action,
        'SUCCESS',
        th.user_id,
        'ticket',
        th.ticket_id::text,
        jsonb_build_object('source', 'ticket_history'),
        th.created_at
      FROM ticket_history th
      JOIN tickets t ON t.id=th.ticket_id
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO system_audit_log (id, category, action, status, user_id, entity_type, entity_id, ip_address, message, metadata, created_at)
      SELECT
        'backup-audit-' || ba.id,
        'BACKUP',
        'BACKUP_' || ba.action,
        ba.status,
        ba.user_id,
        'backup',
        ba.backup_job_id,
        ba.ip_address,
        ba.message,
        jsonb_build_object('source', 'backup_audit'),
        ba.created_at
      FROM backup_audit ba
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      CREATE OR REPLACE FUNCTION audit_ticket_history_event()
      RETURNS TRIGGER AS $$
      BEGIN
        INSERT INTO system_audit_log (id, category, action, status, user_id, entity_type, entity_id, metadata, created_at)
        VALUES (
          'ticket-history-' || NEW.id,
          CASE WHEN EXISTS (SELECT 1 FROM tickets WHERE id=NEW.ticket_id AND type='ORDER') THEN 'ORDER' ELSE 'TICKET' END,
          NEW.action,
          'SUCCESS',
          NEW.user_id,
          'ticket',
          NEW.ticket_id::text,
          jsonb_build_object('source', 'ticket_history'),
          NEW.created_at
        ) ON CONFLICT (id) DO NOTHING;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await client.query("DROP TRIGGER IF EXISTS ticket_history_to_system_audit ON ticket_history");
    await client.query(`
      CREATE TRIGGER ticket_history_to_system_audit
      AFTER INSERT ON ticket_history
      FOR EACH ROW EXECUTE FUNCTION audit_ticket_history_event();
    `);
    await client.query(`
      ALTER TABLE IF EXISTS offers
      ADD COLUMN IF NOT EXISTS ticket_id INT REFERENCES tickets(id) ON DELETE SET NULL;
    `);
    console.log("client ticket fields, ticket_items, ticket_comments, attachments, ticket_history and system audit ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_templates (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ offer_templates table");

    await client.query(`
      CREATE TABLE IF NOT EXISTS template_items (
        id SERIAL PRIMARY KEY,
        template_id INT REFERENCES offer_templates(id) ON DELETE CASCADE,
        product_id INT REFERENCES products(id),
        item_number INT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        unit_price DECIMAL(10, 2),
        quantity INT DEFAULT 1,
        sort_order INT
      );
    `);
    console.log("✓ template_items table");

    await client.query(`
      ALTER TABLE template_items
      ADD COLUMN IF NOT EXISTS product_id INT REFERENCES products(id);
    `);
    console.log("template_items product_id column ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS offers (
        id SERIAL PRIMARY KEY,
        offer_number TEXT UNIQUE,
        title TEXT NOT NULL,
        description TEXT,
        object_id INT REFERENCES objects(id),
        customer_id INT REFERENCES customers(id),
        template_id INT REFERENCES offer_templates(id),
        status TEXT DEFAULT 'W REALIZACJI' CHECK (status IN ('W REALIZACJI', 'DO AKCEPTACJI', 'ZAAKCEPTOWANA', 'ODRZUCONA')),
        total_price DECIMAL(10, 2),
        created_by INT REFERENCES users(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ offers table");

    await client.query(`
      ALTER TABLE offers
      ADD COLUMN IF NOT EXISTS offer_number TEXT,
      ADD COLUMN IF NOT EXISTS title TEXT,
      ADD COLUMN IF NOT EXISTS description TEXT,
      ADD COLUMN IF NOT EXISTS object_id INT REFERENCES objects(id),
      ADD COLUMN IF NOT EXISTS customer_id INT REFERENCES customers(id),
      ADD COLUMN IF NOT EXISTS template_id INT REFERENCES offer_templates(id),
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'W REALIZACJI',
      ADD COLUMN IF NOT EXISTS total_price DECIMAL(10, 2),
      ADD COLUMN IF NOT EXISTS created_by INT REFERENCES users(id),
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS issue_date DATE,
      ADD COLUMN IF NOT EXISTS valid_until DATE,
      ADD COLUMN IF NOT EXISTS salesperson TEXT,
      ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'PLN',
      ADD COLUMN IF NOT EXISTS payment_terms TEXT,
      ADD COLUMN IF NOT EXISTS payment_due_days INT,
      ADD COLUMN IF NOT EXISTS delivery_method TEXT,
      ADD COLUMN IF NOT EXISTS delivery_date TEXT,
      ADD COLUMN IF NOT EXISTS realization_time TEXT,
      ADD COLUMN IF NOT EXISTS prepared_by_name TEXT,
      ADD COLUMN IF NOT EXISTS prepared_by_phone TEXT,
      ADD COLUMN IF NOT EXISTS prepared_by_email TEXT,
      ADD COLUMN IF NOT EXISTS remarks TEXT,
      ADD COLUMN IF NOT EXISTS additional_info TEXT,
      ADD COLUMN IF NOT EXISTS client_company_name TEXT,
      ADD COLUMN IF NOT EXISTS client_nip TEXT,
      ADD COLUMN IF NOT EXISTS client_address TEXT,
      ADD COLUMN IF NOT EXISTS client_postal_code TEXT,
      ADD COLUMN IF NOT EXISTS client_city TEXT,
      ADD COLUMN IF NOT EXISTS client_country TEXT,
      ADD COLUMN IF NOT EXISTS client_contact_person TEXT,
      ADD COLUMN IF NOT EXISTS client_phone TEXT,
      ADD COLUMN IF NOT EXISTS client_email TEXT,
      ADD COLUMN IF NOT EXISTS ticket_id INT REFERENCES tickets(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS client_sent_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMP;
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_offers_ticket_id ON offers(ticket_id)");
    await client.query(`
      UPDATE offers
      SET client_sent_at=COALESCE(client_sent_at, updated_at, created_at)
      WHERE ticket_id IS NOT NULL
        AND status IN ('DO AKCEPTACJI','WYSŁANA')
        AND client_sent_at IS NULL
    `);
    await client.query(`
      UPDATE offers
      SET accepted_at=COALESCE(accepted_at, updated_at, created_at)
      WHERE ticket_id IS NOT NULL
        AND status='ZAAKCEPTOWANA'
        AND accepted_at IS NULL
    `);
    await client.query("ALTER TABLE offers DROP CONSTRAINT IF EXISTS offers_status_check");
    await client.query(`
      UPDATE offers
      SET status = 'W REALIZACJI'
      WHERE status IS NULL
        OR status NOT IN ('SZKIC', 'WYSŁANA', 'W REALIZACJI', 'DO AKCEPTACJI', 'ZAAKCEPTOWANA', 'ODRZUCONA', 'ZAKOŃCZONA')
    `);
    await client.query(`
      ALTER TABLE offers
      ADD CONSTRAINT offers_status_check
      CHECK (status IN ('SZKIC', 'WYSŁANA', 'W REALIZACJI', 'DO AKCEPTACJI', 'ZAAKCEPTOWANA', 'ODRZUCONA', 'ZAKOŃCZONA'))
    `);
    console.log("offers commercial columns ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS offer_items (
        id SERIAL PRIMARY KEY,
        offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
        item_number INT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        unit_price DECIMAL(10, 2),
        quantity INT DEFAULT 1,
        total DECIMAL(10, 2)
      );
    `);
    console.log("✓ offer_items table");

    await client.query(`
      ALTER TABLE offer_items
      ADD COLUMN IF NOT EXISTS product_id INT REFERENCES products(id),
      ADD COLUMN IF NOT EXISTS sku TEXT,
      ADD COLUMN IF NOT EXISTS code TEXT,
      ADD COLUMN IF NOT EXISTS unit TEXT,
      ADD COLUMN IF NOT EXISTS vat_rate DECIMAL(5, 2) DEFAULT 23,
      ADD COLUMN IF NOT EXISTS net_total DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS vat_value DECIMAL(12, 2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS gross_total DECIMAL(12, 2) DEFAULT 0;
    `);
    console.log("offer_items commercial columns ensured");

    await client.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id SERIAL PRIMARY KEY,
        offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INT,
        uploaded_by INT REFERENCES users(id),
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ photos table");

    await client.query(`
      CREATE TABLE IF NOT EXISTS comments (
        id SERIAL PRIMARY KEY,
        offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
        author_id INT REFERENCES users(id),
        content TEXT NOT NULL,
        is_internal BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query("ALTER TABLE comments ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT FALSE");
    console.log("✓ comments table");

    await client.query(`
      CREATE TABLE IF NOT EXISTS rejections (
        id SERIAL PRIMARY KEY,
        offer_id INT REFERENCES offers(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        rejected_by INT REFERENCES users(id),
        rejected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✓ rejections table");

    console.log("\n✅ Database migration completed successfully!");
  } catch (err) {
    console.error("❌ Migration error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

async function addPasswordChangedAtColumn({ query }) {
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP");
}

async function addAiTicketCommentColumn({ query }) {
  await query("ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE");
}

async function addAiAssistantSettingsTable({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_assistant_settings (
      id TEXT PRIMARY KEY DEFAULT 'default',
      auto_send_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    INSERT INTO ai_assistant_settings (id)
    SELECT 'default'
    WHERE NOT EXISTS (SELECT 1 FROM ai_assistant_settings WHERE id='default')
  `);
}

async function addAiKnowledgeBaseTable({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_knowledge_base (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'GENERAL',
      created_by INT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function addAiEquipmentTypesTable({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_equipment_types (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await query(`
    INSERT INTO ai_equipment_types (name)
    SELECT name FROM (VALUES
      ('Ogólne'), ('Terminal wjazdowy'), ('Terminal wyjazdowy'),
      ('Terminal wyjazdowy z terminalem płatniczym'), ('Szlaban'), ('Kamera ANPR')
    ) AS defaults(name)
    WHERE NOT EXISTS (SELECT 1 FROM ai_equipment_types)
  `);
}

async function addAiKnowledgeSolutionColumn({ query }) {
  await query(`ALTER TABLE ai_knowledge_base ADD COLUMN IF NOT EXISTS solution TEXT`);
}

async function addAiKnowledgeFilesTable({ query }) {
  await query(`
    CREATE TABLE IF NOT EXISTS ai_knowledge_base_files (
      id SERIAL PRIMARY KEY,
      knowledge_base_id INT NOT NULL REFERENCES ai_knowledge_base(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      original_name TEXT,
      mime_type TEXT,
      file_size INT,
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

export function getMigrationDefinitions() {
  return [
    { ...LEGACY_SCHEMA_MIGRATION, up: runLegacySchemaMigration },
    { ...ADD_PASSWORD_CHANGED_AT_MIGRATION, up: addPasswordChangedAtColumn },
    { ...ADD_AI_TICKET_COMMENT_MIGRATION, up: addAiTicketCommentColumn },
    { ...ADD_AI_ASSISTANT_SETTINGS_MIGRATION, up: addAiAssistantSettingsTable },
    { ...ADD_AI_KNOWLEDGE_BASE_MIGRATION, up: addAiKnowledgeBaseTable },
    { ...ADD_AI_EQUIPMENT_TYPES_MIGRATION, up: addAiEquipmentTypesTable },
    { ...ADD_AI_KNOWLEDGE_SOLUTION_MIGRATION, up: addAiKnowledgeSolutionColumn },
    { ...ADD_AI_KNOWLEDGE_FILES_MIGRATION, up: addAiKnowledgeFilesTable }
  ];
}

export async function migrate() {
  return runVersionedMigrations({
    migrations: getMigrationDefinitions(),
    appVersion: getAppInfo().version
  });
}

export async function getMigrationStatus() {
  return getVersionedMigrationStatus({ migrations: getMigrationDefinitions() });
}

export { CURRENT_SCHEMA_VERSION };

