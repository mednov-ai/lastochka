plugins { java }
repositories { mavenCentral() }
dependencies {
    compileOnly(gradleApi())
    compileOnly("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.21")
    testImplementation("org.jetbrains.kotlin:kotlin-compiler-embeddable:2.3.21")
    testImplementation("org.junit.jupiter:junit-jupiter:5.14.1")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.test { useJUnitPlatform() }
