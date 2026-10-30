package ru.lastochka.integration

import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Proxy
import java.sql.Connection
import java.sql.PreparedStatement
import java.sql.Statement
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import org.springframework.beans.factory.config.BeanPostProcessor
import org.springframework.boot.test.context.TestConfiguration
import org.springframework.context.annotation.Bean
import org.springframework.jdbc.datasource.DelegatingDataSource

object QueryCounter {
    val queries = AtomicInteger()

    fun wrap(connection: Connection): Connection =
        Proxy.newProxyInstance(
            Connection::class.java.classLoader,
            arrayOf(Connection::class.java),
        ) { _, method, args ->
            val result = invoke(connection, method, args)
            if (result is Statement) {
                val type =
                    if (result is PreparedStatement) PreparedStatement::class.java
                    else Statement::class.java
                Proxy.newProxyInstance(type.classLoader, arrayOf(type)) { _, call, parameters ->
                    if (call.name.startsWith("execute")) queries.incrementAndGet()
                    invoke(result, call, parameters)
                }
            } else result
        } as Connection

    private fun invoke(
        target: Any,
        method: java.lang.reflect.Method,
        args: Array<out Any?>?,
    ): Any? =
        try {
            method.invoke(target, *(args ?: emptyArray()))
        } catch (error: InvocationTargetException) {
            throw error.targetException
        }
}

@TestConfiguration(proxyBeanMethods = false)
class QueryCounterConfiguration {
    companion object {
        @Bean
        @JvmStatic
        fun countQueries(): BeanPostProcessor =
            object : BeanPostProcessor {
                override fun postProcessAfterInitialization(bean: Any, beanName: String): Any =
                    if (bean is DataSource)
                        object : DelegatingDataSource(bean) {
                            override fun getConnection(): Connection =
                                QueryCounter.wrap(super.getConnection())

                            override fun getConnection(
                                username: String,
                                password: String,
                            ): Connection =
                                QueryCounter.wrap(super.getConnection(username, password))
                        }
                    else bean
            }
    }
}
