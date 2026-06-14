/**
 * Minimal user shape passed to follow-up / stage-change modals.
 * Defined once here so StatusChangeTrigger and FollowUpScheduleModal
 * share the same type rather than each declaring their own inline version.
 */
export interface OrgUser {
  id: string;
  fullName: string;
  email: string;
}

export interface Lead {
  id: string;
  orgId: string;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  pincode?: string | null;
  cityId?: number | null;
  stateId?: number | null;
  countryId?: number | null;
  campaignId?: string | null;
  stageId: number;
  outcomeId?: number | null;
  outcomeComment?: string | null;
  assignedUserId?: string | null;
  rawWebhookData?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  tags?: string[];
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LeadView {
  leadId: string;
  orgId: string;
  orgName: string;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  stage: string;
  stageLabel?: string | null;
  followupRequired?: boolean | null;
  isRejected?: boolean | null;
  isTerminated?: boolean | null;
  outcome?: string | null;
  outcomeLabel?: string | null;
  outcomeComment?: string | null;
  campaignName?: string | null;
  platform?: string | null;
  assignedRepName?: string | null;
  assignedRepEmail?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  orgId: string;
  firstName: string;
  middleName?: string | null;
  lastName?: string | null;
  fullName: string;
  email: string;
  roleId: number;
  role?: string | null;
  rank?: number | null;
  roleLabel?: string | null;
  managerId?: string | null;
  isActive: boolean;
  passwordHash?: string | null;
  passwordChangedAt?: string | null;
  forcePasswordChange?: boolean | null;
  lastLoginAt?: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  orgName?: string | null;
  tenantName?: string | null;
}

export interface Session {
  sub: string;
  email: string;
  role: string;
  orgId: string;
  tenantId?: string;
  pwdIat: number;
}

export interface Campaign {
  id: string;
  orgId: string;
  name: string;
  platformId: number;
  statusId: number;
  budget?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FollowUp {
  id: string;
  orgId: string;
  leadId: string;
  assignedUserId?: string | null;
  scheduledAt: string;
  completedAt?: string | null;
  statusId: number;
  notes?: string | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Interaction {
  id: string;
  orgId: string;
  leadId: string;
  userId: string;
  interactionTypeId: number;
  notes?: string | null;
  durationSeconds?: number | null;
  occurredAt: string;
  isDeleted: boolean;
  createdAt: string;
}

export interface LookupItem {
  id: number;
  name: string;
  description?: string | null;
  label?: string;
}

export interface OrgChartNode {
  memberId: string;
  memberFullName: string;
  memberEmail?: string | null;
  memberRole?: string | null;
  managerId?: string | null;
  depth?: number;
}

export interface LeadStage {
  id: number;
  name: string;
  description: string | null;
  label: string;
  followupRequired: boolean;
  isRejected: boolean;
  isTerminated: boolean;
}

export interface LeadStageOutcome {
  id: number;
  stageId: number;
  name: string;
  label: string;
  description: string | null;
  requiresComment: boolean;
  displayOrder: number;
}

export interface LeadStatusLogEntry {
  id: string;
  orgId: string;
  leadId: string;
  oldStageId: number | null;
  newStageId: number;
  oldOutcomeId: number | null;
  newOutcomeId: number | null;
  assignedUserId: string | null;
  changedById: string | null;
  transitionNote: string | null;
  changedAt: string;
  oldStageName?: string | null;
  newStageName?: string | null;
  changedByName?: string | null;
}

export interface FollowUpEnriched {
  followUpId: string;
  orgId: string;
  orgName: string;
  leadId: string;
  leadFullName: string;
  leadPhone: string | null;
  leadEmail: string | null;
  leadStage: string;
  leadTags: string[];
  assignedRepId: string;
  assignedRepName: string;
  assignedRepEmail: string;
  followUpStatus: string;
  scheduledAt: string;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  isOverdue: boolean;
  minutesOverdue: number | null;
  lastInteractionAt: string | null;
  lastInteractionType: string | null;
}

export interface TimelineEvent {
  eventId: string;
  orgId: string;
  leadId: string;
  eventType: 'status_change' | 'follow_up' | 'interaction' | 'assignment_change';
  eventAt: string;
  actorName: string | null;
  actorEmail: string | null;
  oldStage: string | null;
  oldStageLabel: string | null;
  newStage: string | null;
  newStageLabel: string | null;
  oldOutcome: string | null;
  oldOutcomeLabel: string | null;
  newOutcome: string | null;
  newOutcomeLabel: string | null;
  assignedToName: string | null;
  note: string | null;
  followupId: string | null;
  followupStatus: string | null;
  scheduledAt: string | null;
  completedAt: string | null;
  interactionType: string | null;
}

export interface StatusChangePayload {
  leadId: string;
  newStage: string;
  outcomeId?: number;
  outcomeComment?: string;
  transitionNote?: string;
  followUp?: {
    assignedUserId: string;
    scheduledAt: string;
    notes?: string;
  };
}
