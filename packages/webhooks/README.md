# `@agentpey/webhooks`

A delivery worker for a webhook event that has already been created by the
calling application. It does not decide whether an event should exist or be
emitted; it only POSTs the supplied event to a partner endpoint.

`deliverWebhook` serializes the event once, signs that exact body with
`signWebhookPayload` from `@agentpey/partner-api`, and sends the result in
the `agentpay-signature` header.

## Retries

The default is five attempts. Network failures, a request that exceeds the
10-second timeout, and HTTP 5xx responses retry. HTTP 4xx responses do not
retry because they indicate a partner-side request problem. Other non-2xx
responses also stop without retrying.

Between retries, the worker waits `min(1000 * 2^(attempt - 1), 30000)` ms,
then adds a uniformly random 0–250 ms jitter. The first retry therefore waits
1.0–1.25 seconds, then 2.0–2.25 seconds, 4.0–4.25 seconds, and so on, capped
at 30.25 seconds.

`createFailedDeliveryQueue()` supplies a small in-memory queue. Its `deliver`
method delegates to `deliverWebhook` and records an exhausted delivery without
storing the endpoint secret. The queue is intentionally not durable.
