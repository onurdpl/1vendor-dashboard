import fs from 'node:fs';

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .reduce((acc, line) => {
      const separatorIndex = line.indexOf('=');
      if (separatorIndex === -1) {
        return acc;
      }

      const key = line.slice(0, separatorIndex).trim();
      const rawValue = line.slice(separatorIndex + 1).trim();
      acc[key] = rawValue.replace(/^['"]|['"]$/g, '');
      return acc;
    }, {});
}

export function getEnvValue(key, fallbackEnv) {
  const runtimeValue = process.env[key];
  if (typeof runtimeValue === 'string' && runtimeValue.trim()) {
    return runtimeValue.trim();
  }

  const fallbackValue = fallbackEnv[key];
  return typeof fallbackValue === 'string' ? fallbackValue.trim() : '';
}

export function isValidShopDomain(value) {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(value);
}

export function isAddressTakenErrorMessage(value) {
  return typeof value === 'string' && /address.*already been taken/i.test(value);
}

export function isAddressTakenUserError(userErrors) {
  if (!Array.isArray(userErrors) || userErrors.length === 0) {
    return false;
  }

  return userErrors.every((entry) => isAddressTakenErrorMessage(entry?.message));
}

export function findMatchingSubscription(subscriptions, topic, callbackUrl) {
  return (
    subscriptions.find((subscription) => {
      return subscription.topic === topic && subscription.callbackUrl === callbackUrl;
    }) ?? null
  );
}

export function createShopifyGraphqlClient(config) {
  const endpoint = `https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`;

  return {
    async request(query, variables) {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-shopify-access-token': config.accessToken,
        },
        body: JSON.stringify({
          query,
          variables,
        }),
      });

      if (!response.ok) {
        throw new Error(`Shopify GraphQL request failed with status ${response.status}.`);
      }

      const payload = await response.json();
      if (Array.isArray(payload.errors) && payload.errors.length > 0) {
        throw new Error(`Shopify GraphQL errors: ${payload.errors.map((error) => error.message).join('; ')}`);
      }

      return payload.data ?? {};
    },
  };
}

export async function listWebhookSubscriptions(client) {
  const subscriptions = [];
  let hasNextPage = true;
  let cursor = null;

  while (hasNextPage) {
    const data = await client.request(
      `
        query WebhookSubscriptions($after: String) {
          webhookSubscriptions(first: 100, after: $after) {
            edges {
              cursor
              node {
                id
                topic
                endpoint {
                  __typename
                  ... on WebhookHttpEndpoint {
                    callbackUrl
                  }
                }
              }
            }
            pageInfo {
              hasNextPage
            }
          }
        }
      `,
      { after: cursor },
    );

    const connection = data.webhookSubscriptions;
    const edges = Array.isArray(connection?.edges) ? connection.edges : [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node || typeof node !== 'object') {
        continue;
      }

      const callbackUrl =
        node.endpoint?.__typename === 'WebhookHttpEndpoint' ? node.endpoint.callbackUrl : null;
      if (!callbackUrl) {
        continue;
      }

      subscriptions.push({
        id: String(node.id),
        topic: String(node.topic),
        callbackUrl: String(callbackUrl),
      });
    }

    hasNextPage = Boolean(connection?.pageInfo?.hasNextPage);
    cursor = hasNextPage ? edges.at(-1)?.cursor ?? null : null;
  }

  return subscriptions;
}

export async function createWebhookSubscription(client, topic, callbackUrl) {
  const data = await client.request(
    `
      mutation WebhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $callbackUrl: URL!) {
        webhookSubscriptionCreate(
          topic: $topic
          webhookSubscription: {
            callbackUrl: $callbackUrl
            format: JSON
          }
        ) {
          userErrors {
            field
            message
          }
          webhookSubscription {
            id
            topic
          }
        }
      }
    `,
    { topic, callbackUrl },
  );

  const result = data?.webhookSubscriptionCreate;
  const userErrors = Array.isArray(result?.userErrors) ? result.userErrors : [];
  if (userErrors.length > 0) {
    return {
      ok: false,
      reason: 'user_errors',
      userErrors,
    };
  }

  const subscriptionId = result?.webhookSubscription?.id;
  if (!subscriptionId) {
    return {
      ok: false,
      reason: 'missing_subscription_id',
      userErrors: [],
    };
  }

  return {
    ok: true,
    subscriptionId: String(subscriptionId),
  };
}

export async function registerWebhookTopics({
  client,
  topics,
  baseUrl,
  listSubscriptions = (currentClient) => listWebhookSubscriptions(currentClient),
  createSubscription = (currentClient, topic, callbackUrl) =>
    createWebhookSubscription(currentClient, topic, callbackUrl),
}) {
  const created = [];
  const existing = [];
  const failed = [];
  let subscriptions = await listSubscriptions(client);

  for (const registration of topics) {
    const callbackUrl = `${baseUrl}${registration.routePath}`;

    const existingSubscription = findMatchingSubscription(
      subscriptions,
      registration.topic,
      callbackUrl,
    );
    if (existingSubscription) {
      existing.push({
        topic: registration.topic,
        callbackUrl,
        subscriptionId: existingSubscription.id,
      });
      continue;
    }

    try {
      const createResult = await createSubscription(client, registration.topic, callbackUrl);

      if (createResult.ok) {
        created.push({
          topic: registration.topic,
          callbackUrl,
          subscriptionId: createResult.subscriptionId,
        });
        subscriptions.push({
          id: createResult.subscriptionId,
          topic: registration.topic,
          callbackUrl,
        });
        continue;
      }

      if (isAddressTakenUserError(createResult.userErrors)) {
        subscriptions = await listSubscriptions(client);
        const recoveredSubscription = findMatchingSubscription(
          subscriptions,
          registration.topic,
          callbackUrl,
        );
        if (recoveredSubscription) {
          existing.push({
            topic: registration.topic,
            callbackUrl,
            subscriptionId: recoveredSubscription.id,
          });
          continue;
        }
      }

      failed.push({
        topic: registration.topic,
        callbackUrl,
        reason:
          createResult.userErrors
            .map((entry) => entry.message)
            .filter(Boolean)
            .join('; ') ||
          (createResult.reason === 'missing_subscription_id'
            ? 'Shopify did not return a webhook subscription id.'
            : 'Unknown Shopify registration error.'),
      });
    } catch (error) {
      failed.push({
        topic: registration.topic,
        callbackUrl,
        reason: error instanceof Error ? error.message : 'Unexpected registration error.',
      });
    }
  }

  return {
    created,
    existing,
    failed,
  };
}

export function printRegistrationSummary(summary) {
  console.log('Webhook registration summary:');
  console.log(`created=${summary.created.length}`);
  for (const item of summary.created) {
    console.log(`  created topic=${item.topic} callback=${item.callbackUrl} subscriptionId=${item.subscriptionId}`);
  }

  console.log(`existing=${summary.existing.length}`);
  for (const item of summary.existing) {
    console.log(`  existing topic=${item.topic} callback=${item.callbackUrl} subscriptionId=${item.subscriptionId}`);
  }

  console.log(`failed=${summary.failed.length}`);
  for (const item of summary.failed) {
    console.log(`  failed topic=${item.topic} callback=${item.callbackUrl} reason=${item.reason}`);
  }
}
