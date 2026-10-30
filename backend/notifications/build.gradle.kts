

dependencies { implementation(project(":common")); implementation(project(":identity")) }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("nl.martijndwars:web-push:5.1.2") {
        exclude(group = "org.asynchttpclient", module = "async-http-client")
        exclude(group = "com.beust", module = "jcommander")
    }
    implementation("org.bitbucket.b_c:jose4j:0.9.6")
    implementation("org.bouncycastle:bcprov-jdk18on:1.83")
    implementation("org.apache.httpcomponents:httpclient:4.5.14")
    implementation("org.springframework.boot:spring-boot-starter-jackson")
    implementation("tools.jackson.module:jackson-module-kotlin")
}
