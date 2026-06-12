export interface Lead {
  rowIndex: number;
  leadId?: string;         // UUID from DB — used for DB API update calls

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
  failReasonId?: number;
}
