const RETURN_REVIEW_ATTENTION_STATUSES = ['requested', 'pending', 'in_review', 'in review'] as const;

function insensitiveEquals(value: string) {
  return {
    equals: value,
    mode: 'insensitive' as const,
  };
}

export function isReturnReviewAttentionStatus(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase();
  return Boolean(normalized && RETURN_REVIEW_ATTENTION_STATUSES.includes(normalized as (typeof RETURN_REVIEW_ATTENTION_STATUSES)[number]));
}

export function buildReturnReviewAttentionWhere() {
  const statusFilters = RETURN_REVIEW_ATTENTION_STATUSES.map((status) => ({
    status: insensitiveEquals(status),
  }));
  const lifecycleFilters = RETURN_REVIEW_ATTENTION_STATUSES.map((status) => ({
    returnLifecycleStatus: insensitiveEquals(status),
  }));

  return {
    OR: [
      ...lifecycleFilters,
      {
        AND: [
          {
            OR: [
              { returnLifecycleStatus: null },
              { returnLifecycleStatus: '' },
            ],
          },
          {
            OR: statusFilters,
          },
        ],
      },
    ],
  };
}
