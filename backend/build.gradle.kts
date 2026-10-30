import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    kotlin("jvm") version "2.3.21" apply false
    kotlin("plugin.spring") version "2.3.21" apply false
    kotlin("plugin.jpa") version "2.3.21" apply false
    id("org.springframework.boot") version "4.1.1" apply false
    id("io.spring.dependency-management") version "1.1.7" apply false
}

allprojects {
    group = "ru.lastochka"
    version = "0.1.0"
    repositories { mavenCentral() }
}

subprojects {
    apply(plugin = "org.jetbrains.kotlin.jvm")
    apply(plugin = "org.jetbrains.kotlin.plugin.spring")
    apply(plugin = "io.spring.dependency-management")
    extensions.configure<io.spring.gradle.dependencymanagement.dsl.DependencyManagementExtension> {
        imports { mavenBom("org.springframework.boot:spring-boot-dependencies:4.1.1") }
    }
    extensions.configure<org.jetbrains.kotlin.gradle.dsl.KotlinJvmProjectExtension> {
        jvmToolchain(25)
    }
    tasks.withType<KotlinCompile>().configureEach {
        compilerOptions {
            freeCompilerArgs.addAll("-Xjsr305=strict", "-Xannotation-default-target=param-property")
        }
    }
    tasks.withType<Test>().configureEach { useJUnitPlatform() }
    dependencies {
        "implementation"("org.jetbrains.kotlin:kotlin-reflect")
        "implementation"("io.swagger.core.v3:swagger-annotations-jakarta:2.2.55")
        "testImplementation"("org.springframework.boot:spring-boot-starter-test")
        "testRuntimeOnly"("org.junit.platform:junit-platform-launcher")
    }
}

val architectureCompiler by configurations.creating

dependencies { architectureCompiler("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.21") }

val architectureCheck by tasks.registering(ru.lastochka.architecture.ArchitectureCheck::class)

tasks.register("check") { dependsOn(architectureCheck, subprojects.map { "${it.path}:check" }) }

subprojects {
    tasks
        .matching { it.name == "check" || it.name == "bootJar" }
        .configureEach {
            dependsOn(rootProject.tasks.named("architectureCheck"))
        }
}
