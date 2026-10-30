package ru.lastochka.architecture;
import java.nio.file.Path;
public final class PolicyMain {
 public static void main(String[] args) throws Exception {
  try(var policy=new BackendPolicy()) {
   var failures=policy.check(Path.of(args[0]));
   if(!failures.isEmpty()) { System.err.println(String.join("\n",failures)); System.exit(1); }
  }
 }
}
