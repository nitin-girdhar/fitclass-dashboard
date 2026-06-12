// Semantic column names the code recognises for special behaviour.
// If a header isn't in this list the column renders as plain read-only text.
export const SEMANTIC_HEADERS = {
  status:    'Status',
  comments:  'Remarks',
  transferTo:'Transfer To',
  fullName:  'Name',
  phone:     'Phone Number',
  date:      'Date',
  email:     'Email Address',
} as const;
