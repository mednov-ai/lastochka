package ru.lastochka.integration

import java.sql.DriverManager
import java.util.UUID
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.testcontainers.images.builder.Transferable
import org.testcontainers.postgresql.PostgreSQLContainer

/** Both databases are freshly created in this test's disposable container; no existing volume is used. */
class PermanentMigrationRestoreTest {
    @Test
    fun `restored version 24 data survives permanent schedule migrations and repeated seed`() {
        PostgreSQLContainer("postgres:17.6-alpine").use { db ->
            db.start()
            fun migrate(url: String, target: String? = null) {
                val configuration = Flyway.configure().dataSource(url, db.username, db.password)
                    .locations("classpath:db/migration")
                if (target != null) configuration.target(target)
                configuration.load().migrate()
            }
            val source = db.jdbcUrl
            migrate(source, "24")
            val account = UUID.randomUUID()
            val group = UUID.randomUUID()
            val series = UUID.randomUUID()
            val session = UUID.randomUUID()
            val request = UUID.randomUUID()
            val primarySession = UUID.randomUUID().toString()
            val browserSession = UUID.randomUUID().toString()
            DriverManager.getConnection(source, db.username, db.password).use { connection ->
                connection.createStatement().use { sql ->
                    sql.execute("""INSERT INTO accounts(id,email,name,password_hash,role,login,admin_enabled)
                        VALUES('$account','fixture@example.invalid','Тест','test-hash','STAFF','fixture',true)""")
                    sql.execute("INSERT INTO staff_permissions(account_id,permission) VALUES('$account','SCHEDULE_EDIT')")
                    sql.execute("""INSERT INTO spring_session(primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name)
                        VALUES('$primarySession','$browserSession',1,1,1800,9999999999999,'fixture')""")
                    sql.execute("""INSERT INTO spring_session_attributes(session_primary_id,attribute_name,attribute_bytes)
                        VALUES('$primarySession','fixture',decode('0102','hex'))""")
                    sql.execute("INSERT INTO schedule_groups(id,parameters) VALUES('$group','{\"name\":\"Тест\"}'::jsonb)")
                    sql.execute("""INSERT INTO session_series(id,group_id,rule) VALUES('$series','$group',
                        '{"startDate":"2040-01-01","endDate":"2040-01-28","weekdays":[1],"startTime":"17:00","durationMinutes":60,"title":"Тест","capacity":8}'::jsonb)""")
                    sql.execute("""INSERT INTO studio_sessions(id,title,format,starts_at,ends_at,capacity,status,age_from,age_to)
                        VALUES('$session','Тест','GROUP','2040-01-10T14:00:00Z','2040-01-10T15:00:00Z',8,'OPEN',8,9)""")
                    sql.execute("""INSERT INTO session_group_links(session_id,group_id,series_id,original_date,is_exception)
                        VALUES('$session','$group','$series','2040-01-09',true)""")
                    sql.execute("""INSERT INTO recurrence_history(aggregate_id,actor_id,action,operation_id,affected)
                        VALUES('$series','$account','PUBLISHED','${UUID.randomUUID()}',1)""")
                    sql.execute("""INSERT INTO enrollment_requests(id,parent_name,phone,child_name,child_age,desired_session_id,desired_session_snapshot)
                        VALUES('$request','Тест','79990000000','Ребёнок',8,'$session','сохранённый снимок')""")
                    sql.execute("""INSERT INTO audit_events(aggregate_id,actor_id,action,occurred_at,after_state)
                        VALUES('$session','$account','TEST',now(),'{"value":"история"}'::jsonb)""")
                }
            }
            val dump = db.execInContainer("pg_dump", "-U", db.username, "--no-owner", "--no-acl", db.databaseName)
            assertEquals(0, dump.exitCode, dump.stderr)
            val restoreFile = "/tmp/lastochka-synthetic-v24.sql"
            db.copyFileToContainer(Transferable.of(dump.stdout.toByteArray(Charsets.UTF_8), 384), restoreFile)
            val create = db.execInContainer("createdb", "-U", db.username, "isolated_restore")
            assertEquals(0, create.exitCode, create.stderr)
            val restore = db.execInContainer("psql", "-v", "ON_ERROR_STOP=1", "-U", db.username,
                "-d", "isolated_restore", "-f", restoreFile)
            assertEquals(0, restore.exitCode, restore.stderr)
            val restored = source.substringBefore('?').substringBeforeLast('/') + "/isolated_restore"
            fun snapshot(url: String): List<String> = DriverManager.getConnection(url, db.username, db.password).use { connection ->
                listOf(
                    "SELECT id,email,name,role,login,admin_enabled,auth_version,permission_revision FROM accounts ORDER BY id",
                    "SELECT account_id,permission FROM staff_permissions ORDER BY account_id,permission",
                    "SELECT primary_id,session_id,creation_time,last_access_time,max_inactive_interval,expiry_time,principal_name FROM spring_session ORDER BY primary_id",
                    "SELECT session_primary_id,attribute_name,encode(attribute_bytes,'hex') FROM spring_session_attributes ORDER BY session_primary_id,attribute_name",
                    "SELECT id,version,parameters FROM schedule_groups ORDER BY id",
                    "SELECT id,group_id,version,rule,draft,draft_version,draft_base_version FROM session_series ORDER BY id",
                    "SELECT id,title,format,starts_at,ends_at,capacity,status,version,age_from,age_to FROM studio_sessions ORDER BY id",
                    "SELECT session_id,group_id,series_id,original_date,is_exception FROM session_group_links ORDER BY session_id",
                    "SELECT id,aggregate_id,actor_id,action,occurred_at,operation_id,rule,affected FROM recurrence_history ORDER BY id",
                    "SELECT id,public_number,parent_name,phone,child_name,child_age,desired_session_id,desired_session_snapshot,comment,created_at FROM enrollment_requests ORDER BY id",
                    "SELECT id,aggregate_id,actor_id,action,occurred_at,before_state,after_state,reason FROM audit_events ORDER BY id",
                ).map { query -> connection.createStatement().use { statement ->
                    statement.executeQuery("SELECT COALESCE(string_agg(row_to_json(t)::text, E'\\n'), '') FROM ($query) t").use { result -> result.next(); result.getString(1) }
                } }
            }
            val before = snapshot(restored)
            assertEquals(snapshot(source), before)
            migrate(restored)
            migrate(restored)
            DriverManager.getConnection(restored, db.username, db.password).use { connection ->
                connection.createStatement().use { sql ->
                    val seed = javaClass.getResource("/db/migration/V25__age_directions.sql")!!.readText()
                    sql.execute(seed)
                    sql.executeQuery("SELECT count(*) FROM age_directions WHERE id::text LIKE 'b8c0a000-%'").use { result -> result.next(); assertEquals(5, result.getInt(1)) }
                    sql.executeQuery("SELECT count(*) FROM session_series WHERE age_direction_id IS NOT NULL").use { result -> result.next(); assertEquals(0, result.getInt(1)) }
                    sql.executeQuery("SELECT count(*) FROM flyway_schema_history WHERE success AND version IN ('25','26','27')").use { result -> result.next(); assertEquals(3, result.getInt(1)) }
                }
            }
            assertEquals(before, snapshot(restored))
        }
    }
}
