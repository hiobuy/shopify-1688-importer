import { AppError } from "./errors";
export interface AdminClient {
  graphql(
    query: string,
    options?: { variables?: Record<string, unknown> },
  ): Promise<Response>;
}
export async function graphql<T = any>(
  admin: AdminClient,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let response: Response;
  let body: any;
  try {
    response = await admin.graphql(query, { variables });
    body = await response.json();
  } catch {
    throw new AppError(
      "Shopify did not complete the request. Use safe retry from Import history; the operation may already have reached Shopify.",
      502,
      "SHOPIFY_CONNECTION_ERROR",
    );
  }
  if (!response.ok || body.errors?.length || !body.data)
    throw new AppError(
      "Shopify rejected the API request. Check app permissions, API availability and Import history before retrying.",
      502,
      "SHOPIFY_GRAPHQL_ERROR",
      response.headers.get("x-request-id") || undefined,
    );
  return body.data as T;
}
export function assertUserErrors(
  errors: { field?: string[]; message: string }[] | undefined,
) {
  if (errors?.length)
    throw new AppError(
      errors
        .map((e) => `${e.field?.join(".") || "Product"}: ${e.message}`)
        .join("; ")
        .slice(0, 1500),
      422,
      "SHOPIFY_VALIDATION_ERROR",
    );
}
export async function shopContext(admin: AdminClient) {
  const data = await graphql(
    admin,
    `
      query ImporterShopContext {
        shop {
          name
          myshopifyDomain
          currencyCode
        }
        currentAppInstallation {
          accessScopes {
            handle
          }
        }
      }
    `,
  );
  const scopes = (data.currentAppInstallation?.accessScopes || []).map(
    (s: { handle: string }) => s.handle,
  );
  const required = [
    "read_products",
    "write_products",
    "read_files",
    "write_files",
  ];
  return {
    name: String(data.shop.name),
    domain: String(data.shop.myshopifyDomain),
    currency: String(data.shop.currencyCode),
    scopes: scopes as string[],
    missingScopes: required.filter((s) => !scopes.includes(s)),
  };
}
export async function listCollections(admin: AdminClient, after?: string) {
  const data = await graphql(
    admin,
    `
      query ImporterCollections($after: String) {
        collections(
          first: 100
          after: $after
          query: "collection_type:custom"
        ) {
          nodes {
            id
            title
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
    { after: after || null },
  );
  return data.collections as {
    nodes: { id: string; title: string }[];
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}
