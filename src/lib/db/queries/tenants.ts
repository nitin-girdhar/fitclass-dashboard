/**
 * Tenant queries — cross-org tenant dashboard operations.
 */
import { withTenantTx, withServiceTx } from "../transaction";

/**
 * Get tenant dashboard summary (full KPI rollup).
 */
export async function getTenantDashboard(tenantId: string, userId: string) {
  return withTenantTx(tenantId, userId, async (tx) => {
    const [dashboard] = await tx`
      SELECT * FROM vw_tenant_full_dashboard
      WHERE tenant_id = ${tenantId}
    `;
    return dashboard || null;
  });
}

/**
 * Get campaign summary for all orgs under a tenant.
 */
export async function getTenantCampaignSummary(
  tenantId: string,
  userId: string,
) {
  return withTenantTx(tenantId, userId, async (tx) => {
    return tx`
      SELECT * FROM vw_tenant_campaign_summary
      WHERE tenant_id = ${tenantId}
      ORDER BY org_name, campaign_name
    `;
  });
}

/**
 * Get all organizations under a tenant.
 */
export async function getTenantOrganizations(tenantId: string) {
  return withServiceTx(async (tx) => {
    return tx`
      SELECT o.id, o.name, o.city_id, o.state_id, o.country_id, 
             o.is_active, o.created_at, o.updated_at
      FROM organizations o
      WHERE o.tenant_id = ${tenantId} AND NOT o.is_deleted
      ORDER BY o.name
    `;
  });
}

/**
 * Get tenant details.
 */
export async function getTenantById(tenantId: string) {
  return withServiceTx(async (tx) => {
    const [tenant] = await tx`
      SELECT id, name, is_active, created_at, updated_at
      FROM tenants
      WHERE id = ${tenantId}
    `;
    return tenant || null;
  });
}
