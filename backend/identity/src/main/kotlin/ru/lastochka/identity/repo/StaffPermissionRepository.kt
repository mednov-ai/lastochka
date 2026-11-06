package ru.lastochka.identity.repo

import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import ru.lastochka.identity.entity.StaffPermission
import ru.lastochka.identity.entity.StaffPermissionId

interface StaffPermissionRepository : JpaRepository<StaffPermission, StaffPermissionId> {
    @Query("select p.id.permission from StaffPermission p where p.id.accountId=:id")
    fun permissions(id: UUID): Set<String>

    @Query("select p from StaffPermission p where p.id.accountId in :ids")
    fun forAccounts(ids: Set<UUID>): List<StaffPermission>

    @Modifying
    @Query("delete from StaffPermission p where p.id.accountId=:id")
    fun deleteForAccount(id: UUID): Int
}
