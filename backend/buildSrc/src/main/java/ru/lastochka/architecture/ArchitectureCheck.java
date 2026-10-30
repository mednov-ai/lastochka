package ru.lastochka.architecture;
import java.io.IOException;
import java.util.*;
import org.gradle.api.*;
import org.gradle.api.artifacts.ProjectDependency;
import org.gradle.api.tasks.TaskAction;

public abstract class ArchitectureCheck extends DefaultTask {
    @javax.inject.Inject protected abstract org.gradle.process.ExecOperations getExecOperations();
    @TaskAction public void verify() throws IOException {
        {
            getExecOperations().javaexec(spec -> {
                spec.getMainClass().set("ru.lastochka.architecture.PolicyMain");
                spec.classpath(getProject().getConfigurations().getByName("architectureCompiler"), getProject().file("buildSrc/build/libs/buildSrc.jar"));
                spec.args(getProject().getRootDir().getAbsolutePath());
            }).assertNormalExitValue();
            var failures=new ArrayList<String>();
            var graph=new TreeMap<String,Set<String>>();
            for(var project:getProject().getAllprojects()) {
                var targets=new TreeSet<String>();
                for(var configuration:project.getConfigurations()) for(var dependency:configuration.getDependencies()) if(dependency instanceof ProjectDependency target) targets.add(target.getPath());
                graph.put(project.getPath(), targets);
                if(project.getName().equals("common") && !targets.isEmpty()) failures.add("common/build.gradle.kts: COMMON_DEPENDENCY: "+targets);
            }
            for(var path:graph.keySet()) cycle(path,path,graph,new HashSet<>(),failures);
            if(!failures.isEmpty()) throw new GradleException("Нарушения архитектуры backend:\n"+String.join("\n",failures));
            getLogger().lifecycle("Архитектура backend: нарушений нет");
        }
    }
    private static void cycle(String root,String node,Map<String,Set<String>> graph,Set<String> seen,List<String> failures) {
        if(!seen.add(node)) return;
        for(var next:graph.getOrDefault(node,Set.of())) {
            if(next.equals(root)) failures.add("build.gradle.kts: MODULE_CYCLE: "+root+" → "+node);
            else cycle(root,next,graph,seen,failures);
        }
    }
}
