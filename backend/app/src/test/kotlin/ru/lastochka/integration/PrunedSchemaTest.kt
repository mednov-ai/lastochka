package ru.lastochka.integration

import java.sql.DriverManager
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.testcontainers.postgresql.PostgreSQLContainer

class PrunedSchemaTest {
    private fun database(block: (PostgreSQLContainer) -> Unit) {
        val db = PostgreSQLContainer("postgres:17.6-alpine").apply { start() }
        try {
            block(db)
        } finally {
            db.stop()
        }
    }

    private fun migrate(db: PostgreSQLContainer, target: String) =
        Flyway.configure()
            .dataSource(db.jdbcUrl, db.username, db.password)
            .locations("classpath:db/migration")
            .target(target)
            .load()
            .migrate()

    private fun sql(db: PostgreSQLContainer, value: String): String =
        DriverManager.getConnection(db.jdbcUrl, db.username, db.password).use { c ->
            c.createStatement().use { s ->
                if (s.execute(value))
                    s.resultSet.use { r -> if (r.next()) r.getString(1).orEmpty() else "" }
                else ""
            }
        }

    @Test
    fun `populated V11 retains all current aggregates and drops exactly retired tables`() =
        database { db ->
            migrate(db, "11")
            sql(
                db,
                "INSERT INTO accounts(id,email,name,password_hash,role,login,admin_enabled) VALUES('00000000-0000-0000-0000-000000000001','internal-principal','Admin','preserved-hash','ADMIN','admin',true)",
            )
            sql(
                db,
                "INSERT INTO enrollment_requests(id,parent_name,phone,child_name,child_age) VALUES('00000000-0000-0000-0000-000000000002','Parent','+79001234567','Child',7)",
            )
            sql(
                db,
                "INSERT INTO telegram_outbox(enquiry_id,body) VALUES('00000000-0000-0000-0000-000000000002','Saved event')",
            )
            sql(
                db,
                "INSERT INTO payment_requests(id,amount_minor,purpose,recipient_name,phone,enquiry_id,created_by) VALUES(gen_random_uuid(),12345,'Purpose','Parent','+79001234567','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001')",
            )
            sql(
                db,
                "INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status) VALUES('00000000-0000-0000-0000-000000000003','Preserved session','GROUP',now()+interval '30 days',now()+interval '30 days 1 hour',8,'OPEN')",
            )
            sql(
                db,
                "INSERT INTO audit_events(aggregate_id,actor_id,action,occurred_at) VALUES('00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001','SESSION_CREATE',now())",
            )
            sql(
                db,
                "INSERT INTO idempotency_records(actor_id,operation,key,request_hash,response,expires_at) VALUES('00000000-0000-0000-0000-000000000001','session.create','preserved-replay','hash','{}',now()+interval '1 day')",
            )
            sql(
                db,
                "INSERT INTO enquiry_replays(key,request_hash,enquiry_id,expires_at) VALUES(gen_random_uuid(),'hash','00000000-0000-0000-0000-000000000002',now()+interval '1 day')",
            )
            sql(
                db,
                "INSERT INTO user_entities(id,name,display_name) VALUES('preserved-handle','internal-principal','Admin')",
            )
            sql(
                db,
                "INSERT INTO user_credentials(credential_id,user_entity_user_id,public_key,signature_count,uv_initialized,backup_eligible,authenticator_transports,public_key_credential_type,backup_state,created,last_used,label) VALUES('preserved-credential','preserved-handle',decode('aabb','hex'),42,true,false,'internal','public-key',false,now(),now(),'Existing key')",
            )
            sql(
                db,
                "INSERT INTO webauthn_challenges(session_id,account_id,kind,payload,expires_at) VALUES('preserved-session','00000000-0000-0000-0000-000000000001','GET','{}',now()+interval '5 minutes')",
            )
            sql(
                db,
                "INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time) VALUES('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000011',0,0,1800,9999999999999)",
            )
            val tables =
                listOf(
                    "accounts",
                    "user_entities",
                    "user_credentials",
                    "spring_session",
                    "webauthn_challenges",
                    "studio_settings",
                    "studio_sessions",
                    "landing_content",
                    "audit_events",
                    "idempotency_records",
                    "enrollment_requests",
                    "enquiry_replays",
                    "telegram_outbox",
                    "payment_requests",
                    "concept_state",
                )
            fun snapshot() = tables.associateWith {
                sql(
                    db,
                    "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM $it t",
                )
            }
            val before = snapshot()
            migrate(db, "12")
            assertEquals(before, snapshot())
            val preservedV12 = snapshot()
            migrate(db, "13")
            for ((table, value) in preservedV12) {
                val after =
                    if (table == "studio_sessions")
                        sql(
                            db,
                            "SELECT coalesce(jsonb_agg(to_jsonb(t)-'age_from'-'age_to' ORDER BY (to_jsonb(t)-'age_from'-'age_to')::text),'[]'::jsonb)::text FROM studio_sessions t",
                        )
                    else snapshot().getValue(table)
                assertEquals(value, after, table)
            }
            assertEquals("0", sql(db, "SELECT count(*) FROM session_edit_drafts"))
            val beforeV14 = snapshot()
            migrate(db, "14")
            for ((table, value) in beforeV14) {
                val after =
                    if (table == "accounts")
                        sql(
                            db,
                            "SELECT coalesce(jsonb_agg(to_jsonb(t)-'must_change_password'-'temporary_password_expires_at' ORDER BY (to_jsonb(t)-'must_change_password'-'temporary_password_expires_at')::text),'[]'::jsonb)::text FROM accounts t",
                        )
                    else snapshot().getValue(table)
                assertEquals(value, after, table)
            }
            assertEquals(
                "0",
                sql(
                    db,
                    "SELECT count(*) FROM accounts WHERE must_change_password OR temporary_password_expires_at IS NOT NULL",
                ),
            )
            assertEquals(
                0,
                db.execInContainer(
                        "pg_dump",
                        "-U",
                        db.username,
                        "-Fc",
                        "-f",
                        "/tmp/password-backup.dump",
                        db.databaseName,
                    )
                    .exitCode,
            )
            assertEquals(
                0,
                db.execInContainer("createdb", "-U", db.username, "password_restore").exitCode,
            )
            assertEquals(
                0,
                db.execInContainer(
                        "pg_restore",
                        "-U",
                        db.username,
                        "-d",
                        "password_restore",
                        "/tmp/password-backup.dump",
                    )
                    .exitCode,
            )
            DriverManager.getConnection(
                    db.jdbcUrl.substringBeforeLast("/") + "/password_restore",
                    db.username,
                    db.password,
                )
                .use { restored ->
                    for (table in tables) restored.createStatement().use { query ->
                        query
                            .executeQuery(
                                "SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb)::text FROM $table t"
                            )
                            .use { rows ->
                                assertTrue(rows.next())
                                assertEquals(
                                    snapshot().getValue(table),
                                    rows.getString(1),
                                    "restore $table",
                                )
                            }
                    }
                }

            for (t in
                listOf(
                    "children",
                    "bookings",
                    "auth_tokens",
                    "notification_outbox",
                    "attendance_grants",
                    "attendance_contexts",
                    "move_previews",
                )) assertEquals("", sql(db, "SELECT to_regclass('$t')::text"))
        }

    @Test
    fun `unexpected old data prevents destructive migration atomically`() = database { db ->
        migrate(db, "11")
        sql(
            db,
            "INSERT INTO notification_outbox(event_id,aggregate_id,recipient,subject,body) VALUES(gen_random_uuid(),gen_random_uuid(),'fixture','Subject','Preserve unexpected data')",
        )
        assertThrows(Exception::class.java) { migrate(db, "12") }
        assertEquals("1", sql(db, "SELECT count(*) FROM notification_outbox"))
        assertEquals("children", sql(db, "SELECT to_regclass('children')::text"))
    }

    @Test
    fun `unplanned foreign key prevents drop without cascade`() = database { db ->
        migrate(db, "11")
        sql(db, "CREATE TABLE unexpected_reference(child_id uuid REFERENCES children(id))")
        assertThrows(Exception::class.java) { migrate(db, "12") }
        assertEquals("bookings", sql(db, "SELECT to_regclass('bookings')::text"))
    }

    @Test
    fun `fresh install traverses unchanged migration history`() = database { db ->
        migrate(db, "12")
        assertEquals(
            "12",
            sql(db, "SELECT max(version::int) FROM flyway_schema_history WHERE success"),
        )
    }
}
