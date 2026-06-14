export interface Lead {
  rowIndex: number;
  leadId?: string;

  rawCells: string[];

  createdTime:        string;
  Status:             string;
  Comments:           string;
  transferTo:         string;
  fullName:           string;
  phoneNumber:        string;
  email:              string;
  address:            string;
  reason:             string;
  campaignName:       string;
  joiningPlan:        string;
  membershipInterest: string;
  fitnessGoal:        string;

  // Extra fields from DB view (not in Sheets path)
  assignedUserId?:  string | null;
  assignedRepName?: string | null;
  platform?:        string;
  orgId?:           string;
  orgName?:         string;
  stageId?:         number | null;
  outcomeId?:       number | null;
  outcomeLabel?:    string | null;
  outcomeComment?:  string | null;
}

export interface StatsData {
  total: number;
  lastUpdated: Date | null;
}

export interface UpdatePayload {
  rowIndex: number;
  leadId?: string;
  field: 'Status' | 'Comments';
  value: string;
  followUp?: {
    assignedUserId: string;
    scheduledAt: string;
    notes?: string | null;
  };
  outcomeId?: number;
  outcomeComment?: string;
  transitionNote?: string;
}
