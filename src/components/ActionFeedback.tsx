type ActionFeedbackProps = {
  tone?: 'success' | 'error' | 'info';
  message: string;
};

export function ActionFeedback({ tone = 'success', message }: ActionFeedbackProps) {
  return <p className={`action-feedback action-${tone}`}>{message}</p>;
}
