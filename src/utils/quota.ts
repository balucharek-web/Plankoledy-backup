export function isMapsQuotaError(err: unknown): boolean {
  if (!err) return false;
  const text =
    typeof err === 'string'
      ? err
      : err instanceof Error
        ? `${err.name} ${err.message}`
        : JSON.stringify(err);

  const upper = text.toUpperCase();
  return (
    upper.includes('RESOURCE_EXHAUSTED') ||
    upper.includes('OVER_QUERY_LIMIT') ||
    upper.includes('OVERQUOTAMAPERROR') ||
    upper.includes('QUOTAEXCEEDEDERROR') ||
    upper.includes('QUOTA_EXCEEDED') ||
    upper.includes('429')
  );
}

export function notifyIfQuotaExceeded(err: unknown): boolean {
  if (isMapsQuotaError(err)) {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    return true;
  }
  return false;
}
