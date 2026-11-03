import {
  Form,
  useActionData,
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
} from "react-router";
import { login } from "../shopify.server";
export async function loader({ request }: LoaderFunctionArgs) {
  if (new URL(request.url).searchParams.has("shop")) return login(request);
  return null;
}
export async function action({ request }: ActionFunctionArgs) {
  return { errors: await login(request) };
}
export default function Login() {
  const result = useActionData<typeof action>();
  return (
    <main className="login">
      <div className="brand-mark">1688</div>
      <p className="eyebrow">HIOBUY × SHOPIFY</p>
      <h1>
        Your sourcing workflow,
        <br />
        connected.
      </h1>
      <p className="muted">
        An open-source importer for your own Shopify app.
        <br />
        Connect your store to discover, edit and import 1688 products.
      </p>
      <Form method="post">
        <label>
          Shop domain
          <input
            name="shop"
            required
            placeholder="your-store.myshopify.com"
            autoComplete="url"
            pattern="[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com"
          />
        </label>
        {result && (
          <p role="alert">
            Check your shop domain and app installation configuration.
          </p>
        )}
        <button className="primary" type="submit">
          Connect Shopify store ↗
        </button>
      </Form>
      <p className="hint">
        Requires your own Shopify app credentials. HIOBuy credentials stay on
        the server.
      </p>
    </main>
  );
}
