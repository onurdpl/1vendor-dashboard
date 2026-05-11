export type AutomationAlertType = 'Info' | 'Warning' | 'Critical';
export type AutomationAlertStatus = 'New' | 'In Progress' | 'Resolved';

export type AutomationAlertDto = {
  id: string;
  type: AutomationAlertType;
  message: string;
  status: AutomationAlertStatus;
  timestamp: string;
  source: string;
};

export type AutomationSuggestionDto = {
  title: string;
  description: string;
  actionLabel: string;
};

export type AutomationDashboardDto = {
  alerts: AutomationAlertDto[];
  suggestions: AutomationSuggestionDto[];
};
