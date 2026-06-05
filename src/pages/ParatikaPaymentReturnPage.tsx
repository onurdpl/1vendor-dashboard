import { useSearchParams } from 'react-router-dom';

const SENSITIVE_RETURN_PARAM_PATTERN = /password|secret|token|session|card|cvv|cvc|pan|holder|authorization|cookie/i;
const STATUS_PARAM_NAMES = ['responseCode', 'status', 'paymentStatus', 'responseMsg', 'result'];
const REFERENCE_PARAM_NAMES = ['merchantPaymentId', 'paymentId', 'orderId', 'pgTranId', 'pgOrderId'];

function readSafeParam(searchParams: URLSearchParams, names: string[]) {
  for (const name of names) {
    const value = searchParams.get(name) ?? searchParams.get(name.toUpperCase()) ?? searchParams.get(name.toLowerCase());
    if (value?.trim() && !SENSITIVE_RETURN_PARAM_PATTERN.test(name)) {
      return value.trim().slice(0, 120);
    }
  }

  return null;
}

export function ParatikaPaymentReturnPage() {
  const [searchParams] = useSearchParams();
  const receivedStatus = readSafeParam(searchParams, STATUS_PARAM_NAMES);
  const receivedReference = readSafeParam(searchParams, REFERENCE_PARAM_NAMES);

  return (
    <section className="dashboard state-workspace">
      <div className="hero-card operational-card state-card state-info">
        <div className="state-copy">
          <p className="eyebrow">Paratika Payment</p>
          <div className="state-title-row">
            <h2>Payment return received. Verification pending.</h2>
          </div>
          <p className="page-description">
            This placeholder confirms the return request reached Sporgym. No payment, Shopify order, settlement, or payout state has been changed.
          </p>
          {(receivedStatus || receivedReference) && (
            <dl className="operational-summary-list">
              {receivedStatus && (
                <div>
                  <dt>Received status</dt>
                  <dd>{receivedStatus}</dd>
                </div>
              )}
              {receivedReference && (
                <div>
                  <dt>Reference</dt>
                  <dd>{receivedReference}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </div>
    </section>
  );
}
