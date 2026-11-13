package ru.lastochka.architecture;
import static org.junit.jupiter.api.Assertions.*;
import java.nio.file.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class BackendPolicyTest {
    @TempDir Path root;
    private void rejects(String body, String rule) throws Exception {
        try(var policy=new BackendPolicy()) {
            var result=policy.checkSource("demo/src/main/kotlin/ru/lastochka/demo/service/Bad.kt", "package ru.lastochka.demo.service\n"+body);
            assertTrue(result.stream().anyMatch(s->s.contains(rule)),result.toString());
        }
    }
    @Test void rejectsAliasesAndQualifiedDatabaseTypes() throws Exception {
        rejects("import org.springframework.jdbc.core.simple.JdbcClient as Store\nclass Bad(val store: Store)","DB_BOUNDARY");
        rejects("class Bad(val store: org.springframework.jdbc.core.simple.JdbcClient)","DB_TYPE");
    }
    @Test void rejectsSqlFragmentsTemplatesAndWrappers() throws Exception {
        rejects("val fragment = \"FROM bookings WHERE id=:id\"","SQL_OWNER");
        rejects("fun query(id: String) = executor.run(\"\"\"SELECT id FROM bookings WHERE id=$id\"\"\")","SQL_OWNER");
        rejects("fun query() = helper.sql(\"anything\")","DB_CALL");
        rejects("@org.springframework.data.jpa.repository.Query(\"select b from Booking b\") fun find() = Unit","QUERY_OWNER");
    }
    @Test void rejectsNewRulesEvenIfTheyAppearOnce() throws Exception {
        rejects("const val LOCAL_ERROR = \"FRESH_BACKEND_ERROR\"","NEW_CONTRACT_LITERAL");
        rejects("val expiresAfterSeconds = 751L","NUMBER_OWNER");
        rejects("fun error(id: String) = \"FRESH_ERROR_$id\"","TEMPLATE_LITERAL");
        rejects("@Size(max=133) class Request","NUMBER_OWNER");
        rejects("@org.springframework.web.bind.annotation.GetMapping(\"/new-path\") fun find() = Unit","CONTRACT_LITERAL");
    }
    @Test void rejectsCrossModuleAndCommonDependencies() throws Exception {
        rejects("import ru.lastochka.identity.repo.AccountRepository\nclass Bad(val accounts: AccountRepository)","MODULE_OWNER");
        try(var policy=new BackendPolicy()) {
            var failures=policy.checkSource("common/src/main/kotlin/ru/lastochka/common/error/Bad.kt", "package ru.lastochka.common.error\nimport ru.lastochka.identity.dto.PasswordRequest\nclass Bad(val input: PasswordRequest)");
            assertTrue(failures.stream().anyMatch(s->s.contains("COMMON_DEPENDENCY")));
            assertTrue(policy.checkSource("demo/src/main/kotlin/ru/lastochka/demo/RootService.kt","package ru.lastochka.demo\nclass RootService").stream().anyMatch(s->s.contains("ROOT_PACKAGE")));
        }
    }
    @Test void allowsRepositoryGrammarDataAndOrdinaryCounters() throws Exception {
        try(var policy=new BackendPolicy()) {
            assertTrue(policy.checkSource("demo/src/main/kotlin/ru/lastochka/demo/repo/Queries.kt", "package ru.lastochka.demo.repo\n@org.springframework.data.jpa.repository.Query(\"select b from Booking b\") fun find() = Unit").isEmpty());
            assertTrue(policy.checkSource("demo/src/main/kotlin/ru/lastochka/demo/service/Good.kt", "package ru.lastochka.demo.service\nval index=0\nval next=1\nval label=\"Анна\"").isEmpty());
        }
    }
    @Test void rejectsJdbcInsideRepositoriesAndQualifiedAliases() throws Exception {
        try(var policy=new BackendPolicy()) {
            var path="demo/src/main/kotlin/ru/lastochka/demo/repo/Queries.kt";
            assertTrue(policy.checkSource(path,"package ru.lastochka.demo.repo\nimport org.springframework.jdbc.core.simple.JdbcClient as Store\nclass Queries(val jdbc: Store) { fun find() = jdbc.sql(\"select 1\") }").stream().anyMatch(x->x.contains("LOW_LEVEL_DB")));
            assertTrue(policy.checkSource(path,"package ru.lastochka.demo.repo\nclass Queries(val jdbc: org.springframework.jdbc.core.simple.JdbcClient)").stream().anyMatch(x->x.contains("LOW_LEVEL_DB")));
            assertTrue(policy.checkSource(path,"package ru.lastochka.demo.repo\nimport javax.sql.DataSource as Store\nclass Queries(val store: Store)").stream().anyMatch(x->x.contains("LOW_LEVEL_DB")));
        }
    }
    @Test void permitsJdbcOnlyInTheTwoSpecificFlywayEntryPoints() throws Exception {
        try(var policy=new BackendPolicy()) {
            var source="package db.migration\nimport java.sql.DriverManager\nfun run() = DriverManager.getConnection(\"fixture\")";
            var migration="app/src/main/kotlin/db/migration/V28__Alfa_gateway_environments.kt";
            var runner="app/src/main/kotlin/ru/lastochka/migration/AlfaV28TestMigration.kt";
            assertTrue(policy.checkSource(migration,source).stream().noneMatch(x->x.contains("LOW_LEVEL_DB")));
            assertTrue(policy.checkSource(runner,source).stream().noneMatch(x->x.contains("LOW_LEVEL_DB")));
            assertTrue(policy.checkSource("app/src/main/kotlin/db/migration/V29__Other.kt",source).stream().anyMatch(x->x.contains("LOW_LEVEL_DB")));
        }
    }
    @Test void permitsOnlyTheTwoSpringSecurityJdbcAdapters() throws Exception {
        try(var policy=new BackendPolicy()) {
            var path="identity/src/main/kotlin/ru/lastochka/identity/config/IdentityConfiguration.kt";
            var prefix="package ru.lastochka.identity.config\nimport org.springframework.jdbc.core.JdbcOperations\n";
            var good=prefix+"fun users(jdbc: JdbcOperations) = JdbcPublicKeyCredentialUserEntityRepository(jdbc)\nfun credentials(jdbc: JdbcOperations) = JdbcUserCredentialRepository(jdbc)";
            assertTrue(policy.checkSource(path,good).isEmpty());
            var bad=prefix+"fun users(jdbc: JdbcOperations) = jdbc.execute(\"select 1\")";
            assertTrue(policy.checkSource(path,bad).stream().anyMatch(x->x.contains("LOW_LEVEL_DB")));
        }
    }
    @Test void discoversNewModulesResourcesAndAdviceAutomatically() throws Exception {
        Path resource=root.resolve("new-module/src/main/resources/queries.sql");
        Files.createDirectories(resource.getParent()); Files.writeString(resource,"SELECT id FROM bookings");
        Path source=root.resolve("new-module/src/main/kotlin/ru/lastochka/newmodule/service/Bad.kt");
        Files.createDirectories(source.getParent()); Files.writeString(source,"package ru.lastochka.newmodule.service\n@RestControllerAdvice class Bad");
        Path repository=root.resolve("new-module/src/main/kotlin/ru/lastochka/newmodule/repo/Bad.kt");
        Files.createDirectories(repository.getParent()); Files.writeString(repository,"package ru.lastochka.newmodule.repo\nimport org.springframework.jdbc.core.simple.JdbcClient as Store\nclass Bad(val db: Store) { fun read() = db.sql(\"select 1\") }");
        try(var policy=new BackendPolicy()) {
            var failures=policy.check(root);
            assertTrue(failures.stream().anyMatch(s->s.contains("SQL_RESOURCE")));
            assertTrue(failures.stream().anyMatch(s->s.contains("ADVICE_OWNER")));
            assertTrue(failures.stream().anyMatch(s->s.contains("LOW_LEVEL_DB") && s.contains("new-module")));
        }
    }
    @Test void rejectsInlineCopyOfExistingMetadataAndMissingCatalogKey() throws Exception {
        Path metadata=root.resolve("common/src/main/kotlin/ru/lastochka/common/Metadata.kt");
        Files.createDirectories(metadata.getParent()); Files.writeString(metadata,"package ru.lastochka.common\nobject Metadata { object ErrorCodes { const val FAILURE=\"FAILURE_CODE\" } }");
        Path catalog=root.resolve("common/src/main/resources/messages.properties");
        Files.createDirectories(catalog.getParent()); Files.writeString(catalog,"OTHER=Ошибка\n");
        Path service=root.resolve("demo/src/main/kotlin/ru/lastochka/demo/service/Bad.kt");
        Files.createDirectories(service.getParent()); Files.writeString(service,"package ru.lastochka.demo.service\nval error=\"FAILURE_CODE\"");
        try(var policy=new BackendPolicy()) {
            var failures=policy.check(root);
            assertTrue(failures.stream().anyMatch(s->s.contains("LITERAL_OWNER")));
            assertTrue(failures.stream().anyMatch(s->s.contains("CATALOG")));
        }
    }
    @Test void metadataCannotHideQueriesOrBusinessFunctions() throws Exception {
        try(var policy=new BackendPolicy()) {
            var failures=policy.checkSource("common/src/main/kotlin/ru/lastochka/common/Metadata.kt", "package ru.lastochka.common\nobject Metadata { const val QUERY=\"SELECT id FROM bookings\"; fun run() = true }");
            assertTrue(failures.stream().anyMatch(item->item.contains("SQL_OWNER")));
            assertTrue(failures.stream().anyMatch(item->item.contains("METADATA_VALUES_ONLY")));
        }
    }

}
