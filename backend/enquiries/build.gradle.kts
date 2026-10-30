apply(plugin = "org.jetbrains.kotlin.plugin.jpa")

dependencies {
 implementation(project(":common"))
 implementation(project(":identity"))
 implementation(project(":scheduling"))
 implementation(project(":notifications"))
 implementation("org.springframework.boot:spring-boot-starter-webmvc")
 implementation("org.springframework.boot:spring-boot-starter-validation")
 implementation("org.springframework.boot:spring-boot-starter-data-jpa")
 implementation("org.springframework.boot:spring-boot-starter-security")
 implementation("org.springframework.boot:spring-boot-starter-jackson")
}
