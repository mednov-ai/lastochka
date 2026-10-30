package ru.lastochka.architecture;

import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.regex.*;
import java.util.stream.*;
import org.jetbrains.kotlin.cli.jvm.compiler.*;
import org.jetbrains.kotlin.config.CompilerConfiguration;
import org.jetbrains.kotlin.com.intellij.openapi.util.Disposer;
import org.jetbrains.kotlin.com.intellij.psi.PsiElement;
import org.jetbrains.kotlin.psi.*;

/** Build-only source policy. Parses Kotlin instead of treating source as lines of text. */
public final class BackendPolicy implements AutoCloseable {
    private final org.jetbrains.kotlin.com.intellij.openapi.Disposable disposable = Disposer.newDisposable();
    private final KtPsiFactory factory;
    private final Map<String, String> constants = new HashMap<>();
    private final Map<String, String> catalogEntries = new HashMap<>();
    private final List<String> failures = new ArrayList<>();
    private int adviceCount;
    private static final Pattern SQL = Pattern.compile("(?is)(?:^|\\s)(SELECT\\s+.+?\\s+FROM|INSERT\\s+INTO|UPDATE\\s+\\w+\\s+SET|DELETE\\s+FROM|FROM\\s+\\w+\\s+WHERE|WHERE\\s+\\w+\\s*[=<>]|ORDER\\s+BY|FOR\\s+UPDATE)\\b");
    private static final Set<String> DB_TYPES = Set.of("JdbcClient", "JdbcOperations", "JdbcTemplate", "NamedParameterJdbcTemplate", "EntityManager", "DataSource", "Connection", "ResultSet", "RowMapper", "JpaRepository", "CrudRepository");
    private static final Set<String> LOW_DB_TYPES = Set.of("JdbcClient", "JdbcOperations", "JdbcTemplate", "NamedParameterJdbcTemplate", "JdbcTemplateOperations", "DataSource", "Connection", "ResultSet", "RowMapper", "Statement", "PreparedStatement");

    public BackendPolicy() {
        var environment = KotlinCoreEnvironment.createForProduction(disposable, new CompilerConfiguration(), EnvironmentConfigFiles.JVM_CONFIG_FILES);
        factory = new KtPsiFactory(environment.getProject(), false);
    }

    public List<String> check(Path backend) throws IOException {
        failures.clear(); constants.clear(); catalogEntries.clear(); adviceCount = 0;
        var sources = mainFiles(backend,"kotlin").stream().filter(p->p.toString().endsWith(".kt")).sorted().toList();
        var metadata = backend.resolve("common/src/main/kotlin/ru/lastochka/common/Metadata.kt");
        if (Files.exists(metadata)) readConstants(parse(metadata));
        for(var path:mainFiles(backend,"java")) if(path.toString().endsWith(".java")) failures.add(path+": SOURCE_LANGUAGE: production Java требует правил анализа до его добавления");
        for (var path : sources) checkSource(backend.relativize(path).toString(), Files.readString(path));
        if (adviceCount != 1) failures.add("common/error: ADVICE_COUNT: требуется один общий advice, найдено " + adviceCount);
        for(var item:Map.of("ErrorCodes","messages.properties","UserTexts","user-messages.properties").entrySet()) {
            var resources=backend.resolve("common/src/main/resources/"+item.getValue());
            if(!Files.exists(resources)) continue;
            var catalog=new Properties();
            try(var reader=Files.newBufferedReader(resources)) { catalog.load(reader); }
            for(var entry:catalogEntries.entrySet()) if(entry.getKey().startsWith("Metadata."+item.getKey()+".") && !catalog.containsKey(entry.getValue())) failures.add(item.getValue()+": CATALOG: нет сообщения "+entry.getValue());
        }
        for(var p:mainFiles(backend,"resources")) {
            if(p.toString().contains("/db/migration/") || p.toString().contains("/repo/")) continue;
            if(p.toString().matches(".*\\.(sql|jpql|hql|xml|properties|yaml|yml|txt|json)$") && (p.toString().endsWith(".sql") || SQL.matcher(Files.readString(p)).find())) failures.add(p+": SQL_RESOURCE: запрос принадлежит repo");
        }
        return List.copyOf(failures);
    }

    private static List<Path> mainFiles(Path backend, String directory) throws IOException {
        var result=new ArrayList<Path>();
        try(var modules=Files.list(backend)) {
            for(var module:modules.toList()) {
                if(module.getFileName().toString().equals("buildSrc")) continue;
                var source=module.resolve("src/main/"+directory);
                if(!Files.isDirectory(source)) continue;
                try(var files=Files.walk(source)) { result.addAll(files.filter(Files::isRegularFile).toList()); }
            }
        }
        return result;
    }

    private KtFile parse(Path path) throws IOException { return factory.createFile(path.getFileName().toString(), Files.readString(path)); }

    private void readConstants(KtFile file) {
        file.accept(new KtTreeVisitorVoid() {
            @Override public void visitProperty(KtProperty property) {
                var initializer = property.getInitializer();
                if (initializer instanceof KtStringTemplateExpression string && !string.hasInterpolation()) {
                    var parts = new ArrayList<String>();
                    PsiElement owner=property.getParent();
                    while(owner!=null) { if(owner instanceof KtObjectDeclaration object) parts.add(object.getName()); owner=owner.getParent(); }
                    Collections.reverse(parts);
                    String path=String.join(".",parts)+"."+property.getName();
                    constants.putIfAbsent(literal(string), path);
                    if(path.startsWith("Metadata.ErrorCodes.") && !path.endsWith("PATTERN")) catalogEntries.put(path,literal(string));
                    if(path.startsWith("Metadata.UserTexts.")) catalogEntries.put(path,literal(string));
                }
                super.visitProperty(property);
            }
        });
    }

    public List<String> checkSource(String path, String source) {
        var before=failures.size();
        var file=factory.createFile(Path.of(path).getFileName().toString(), source);
        boolean repo=path.contains("/repo/");
        boolean controller=path.contains("/controller/");
        boolean metadata=path.equals("common/src/main/kotlin/ru/lastochka/common/Metadata.kt");
        boolean config=path.contains("/config/");
        String module=path.split("/")[0];
        String packageName=file.getPackageFqName().asString();
        var dbAliases=new HashSet<>(DB_TYPES);
        var lowAliases=new HashSet<>(LOW_DB_TYPES);
        boolean securityConfig=path.equals("identity/src/main/kotlin/ru/lastochka/identity/config/IdentityConfiguration.kt");
        var annotationNames=new HashMap<String,String>();
        if(!metadata && packageName.equals(module.equals("app")?"ru.lastochka":"ru.lastochka."+module) && !path.endsWith("/LastochkaApplication.kt")) fail(path,file,"ROOT_PACKAGE","в корне разрешён только launcher; Metadata — в common");
        for(var directive:file.getImportDirectives()) {
            String name=directive.getImportedFqName()==null?"":directive.getImportedFqName().asString();
            String alias=directive.getAliasName();
            if(alias!=null) annotationNames.put(alias,name.substring(name.lastIndexOf('.')+1));
            boolean db=name.startsWith("org.springframework.jdbc.") || name.startsWith("java.sql.") || name.startsWith("javax.sql.") || name.equals("jakarta.persistence.EntityManager");
            boolean low=name.startsWith("org.springframework.jdbc.") || name.startsWith("java.sql.") || name.startsWith("javax.sql.");
            if(low && alias!=null) lowAliases.add(alias);
            if(low && !(securityConfig && name.equals("org.springframework.jdbc.core.JdbcOperations") && alias==null)) fail(path,directive,"LOW_LEVEL_DB","используйте Spring Data JPA");
            if(db && alias!=null) dbAliases.add(alias);
            if(db && !repo && !config) fail(path,directive,"DB_BOUNDARY","доступ к БД разрешён в repo");
            if(controller && (name.contains(".repo.")||name.contains(".entity."))) fail(path,directive,"CONTROLLER_BOUNDARY","контроллер обращается к сервису/DTO");
            if(name.startsWith("ru.lastochka.")) {
                var segments=name.split("\\.");
                if(segments.length>3 && !segments[2].equals(module) && (name.contains(".repo.")||name.contains(".entity."))) fail(path,directive,"MODULE_OWNER","чужие repo/entity запрещены");
                if(module.equals("common") && segments.length>2 && !segments[2].equals("common")) fail(path,directive,"COMMON_DEPENDENCY","common не зависит от предметных модулей/app");
            }
        }
        file.accept(new KtTreeVisitorVoid() {
            @Override public void visitNamedFunction(KtNamedFunction function) {
                if(metadata) fail(path,function,"METADATA_VALUES_ONLY","Metadata содержит значения, не функции");
                super.visitNamedFunction(function);
            }
            @Override public void visitProperty(KtProperty property) {
                if(metadata && (property.isVar() || property.getGetter()!=null)) fail(path,property,"METADATA_VALUES_ONLY","Metadata содержит неизменяемые значения без вычисляемых getters");
                super.visitProperty(property);
            }
            @Override public void visitAnnotationEntry(KtAnnotationEntry annotation) {
                String name=annotation.getShortName()==null?"":annotation.getShortName().asString();
                name=annotationNames.getOrDefault(name,name);
                if(name.equals("RestControllerAdvice")||name.equals("ControllerAdvice")) {
                    adviceCount++;
                    if(!module.equals("common") || !path.contains("/error/")) fail(path,annotation,"ADVICE_OWNER","общий advice принадлежит common/error");
                }
                if(Set.of("Query","NativeQuery","NamedQuery","NamedNativeQuery","Repository").contains(name) && !repo) fail(path,annotation,"QUERY_OWNER","объявление запроса/репозитория принадлежит repo");
                super.visitAnnotationEntry(annotation);
            }
            @Override public void visitSimpleNameExpression(KtSimpleNameExpression expression) {
                if(lowAliases.contains(expression.getReferencedName()) && !allowedLibraryJdbc(expression,securityConfig)) fail(path,expression,"LOW_LEVEL_DB","используйте Spring Data JPA");
                if(!repo && !config && dbAliases.contains(expression.getReferencedName())) fail(path,expression,"DB_TYPE","низкоуровневый тип принадлежит repo");
                super.visitSimpleNameExpression(expression);
            }
            @Override public void visitUserType(KtUserType type) {
                if((lowAliases.contains(type.getReferencedName()) || type.getText().startsWith("org.springframework.jdbc.") || type.getText().startsWith("java.sql.") || type.getText().startsWith("javax.sql.")) && !allowedLibraryJdbc(type,securityConfig)) fail(path,type,"LOW_LEVEL_DB","используйте Spring Data JPA");
                if(!repo && !config && dbAliases.contains(type.getReferencedName())) fail(path,type,"DB_TYPE","тип хранения принадлежит repo");
                String text=type.getText();
                if(module.equals("common") && text.split("\\.").length > 3 && text.startsWith("ru.lastochka.") && !text.startsWith("ru.lastochka.common.")) fail(path,type,"COMMON_DEPENDENCY","запрещённая полная ссылка на предметный модуль");
                if(text.startsWith("ru.lastochka.") && (text.contains(".repo.")||text.contains(".entity.")) && !text.startsWith("ru.lastochka."+module+".")) fail(path,type,"MODULE_OWNER","чужой repo/entity через полное имя");
                super.visitUserType(type);
            }
            @Override public void visitCallExpression(KtCallExpression call) {
                String name=call.getCalleeExpression()==null?"":call.getCalleeExpression().getText();
                if(Set.of("sql","prepareStatement","createStatement","executeQuery","getConnection").contains(name)) fail(path,call,"LOW_LEVEL_DB","собственные JDBC-операции запрещены");
                if(!repo && Set.of("sql","createNativeQuery","createQuery","prepareStatement","listOfRows","getString","getTimestamp").contains(name)) fail(path,call,"DB_CALL","запрос и разбор строки БД принадлежат repo");
                super.visitCallExpression(call);
            }
            @Override public void visitStringTemplateExpression(KtStringTemplateExpression expression) {
                String text=literal(expression);
                if(!repo && SQL.matcher(text).find()) fail(path,expression,"SQL_OWNER","текст и фрагменты запросов принадлежат repo");
                if(!metadata && expression.hasInterpolation() && !repo) for(var entry:expression.getEntries()) {
                    if(entry instanceof KtLiteralStringTemplateEntry && entry.getText().matches("[A-Z][A-Z0-9_]{2,}")) fail(path,entry,"TEMPLATE_LITERAL","часть кода/статуса должна иметь имя в Metadata");
                }
                if(!metadata && !expression.hasInterpolation() && contractContext(expression) && !annotationDescription(expression)) fail(path,expression,"CONTRACT_LITERAL","маршрут/настройку/шаблон проверки следует добавить в Metadata");
                if(!metadata && !expression.hasInterpolation()) {
                    String constant=constants.get(text);
                    if(constant!=null && !annotationDescription(expression)) fail(path,expression,"LITERAL_OWNER","используйте "+constant);
                    else if(text.matches("[A-Z][A-Z0-9_]{2,}") && !annotationDescription(expression)) fail(path,expression,"NEW_CONTRACT_LITERAL","добавьте именованное значение в Metadata");
                }
                super.visitStringTemplateExpression(expression);
            }
            @Override public void visitConstantExpression(KtConstantExpression expression) {
                String text=expression.getText();
                if(!metadata && text.matches("[0-9]+[lL]?") && Long.parseLong(text.replaceAll("[lL]$",""))>1 && !ordinaryAlgorithmNumber(expression)) fail(path,expression,"NUMBER_OWNER","лимит/срок/размер должен иметь имя в Metadata");
                super.visitConstantExpression(expression);
            }
        });
        return List.copyOf(failures.subList(before,failures.size()));
    }

    private static boolean allowedLibraryJdbc(PsiElement element, boolean securityConfig) {
        if(!securityConfig || !element.getText().equals("JdbcOperations")) return false;
        PsiElement parent=element;
        while(parent!=null && !(parent instanceof KtNamedFunction) && !(parent instanceof KtImportDirective)) parent=parent.getParent();
        if(parent instanceof KtImportDirective directive) return directive.getImportedFqName()!=null && directive.getImportedFqName().asString().equals("org.springframework.jdbc.core.JdbcOperations") && directive.getAliasName()==null;
        if(!(parent instanceof KtNamedFunction function)) return false;
        String name=function.getName();
        String expected=Objects.equals(name,"users") ? "JdbcPublicKeyCredentialUserEntityRepository(jdbc)" : Objects.equals(name,"credentials") ? "JdbcUserCredentialRepository(jdbc)" : "";
        return !expected.isEmpty() && function.getValueParameters().size()==1 && function.getValueParameters().get(0).getText().replaceAll("\\s+", "").equals("jdbc:JdbcOperations") && function.getBodyExpression()!=null && function.getBodyExpression().getText().replaceAll("\\s+", "").equals(expected);
    }

    private static boolean contractContext(PsiElement element) {
        var parent=element.getParent();
        while(parent!=null && !(parent instanceof KtDeclaration)) {
            if(parent instanceof KtCallExpression call && call.getCalleeExpression()!=null && call.getCalleeExpression().getText().equals("Regex")) return true;
            if(parent instanceof KtAnnotationEntry annotation && annotation.getShortName()!=null) {
                String name=annotation.getShortName().asString();
                return name.endsWith("Mapping") || Set.of("Value","ConfigurationProperties","Pattern").contains(name);
            }
            parent=parent.getParent();
        }
        return false;
    }
    private static boolean annotationDescription(PsiElement element) {
        var parent=element.getParent();
        while(parent!=null && !(parent instanceof KtDeclaration)) {
            if(parent instanceof KtValueArgument argument && argument.getArgumentName()!=null && Set.of("description","example").contains(argument.getArgumentName().getText())) return true;
            parent=parent.getParent();
        }
        return false;
    }
    private static boolean ordinaryAlgorithmNumber(PsiElement expression) {
        // Grammar/tuple arity is not a business limit. No file/package exemptions.
        String parent=expression.getParent().getText();
        return parent.equals("limit = 2");
    }
    private static String literal(KtStringTemplateExpression expression) {
        return Arrays.stream(expression.getEntries()).map(entry -> entry instanceof KtEscapeStringTemplateEntry escape ? escape.getUnescapedValue() : entry.getText()).collect(Collectors.joining());
    }
    private void fail(String path,PsiElement element,String rule,String message) {
        String content=element.getContainingFile().getText();
        long line=content.substring(0,element.getTextOffset()).chars().filter(c->c=='\n').count()+1;
        failures.add(path+":"+line+": "+rule+": "+message);
    }
    @Override public void close() { Disposer.dispose(disposable); }
}
