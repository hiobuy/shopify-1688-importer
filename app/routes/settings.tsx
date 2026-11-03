import { useRef, useState } from "react";
import {
  useLoaderData,
  useRevalidator,
  type LoaderFunctionArgs,
} from "react-router";
import { authenticate } from "../shopify.server";
import { publicSettings, syncStoreCurrency } from "../lib/settings.server";
import { shopContext } from "../lib/shopify-graphql.server";
import { api, errorText } from "../lib/client";
import { aiFeatureLabel } from "../lib/ai/capabilities";
import { calculatePrice } from "../lib/pricing";
import { Banner, Badge } from "../components/ui";
import { PageHeader } from "../components/chrome";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.admin(request);
  const context = await shopContext(admin);
  return {
    settings: publicSettings(
      await syncStoreCurrency(session.shop, context.currency),
    ),
    context,
  };
}
export default function Settings() {
  const data = useLoaderData<typeof loader>();
  const revalidator = useRevalidator();
  const [settings, setSettings] = useState(data.settings);
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ai, setAi] = useState<{
    account: string;
    balance: number;
    rules: string;
  } | null>(null);
  const [aiError, setAiError] = useState("");
  const inFlight = useRef(false);
  const cnyStore = data.context.currency === "CNY";
  const example = calculatePrice(10, settings);
  const keyReady = (settings.keyConfigured || !!apiKey.trim()) && !removeKey;
  const unsaved = !!apiKey.trim() || removeKey;
  const account = ai?.account || settings.aiAccount;
  async function persist() {
    const result = await api("saveSettings", {
      settings: { ...settings, apiKey, removeKey },
    });
    setSettings(result.settings);
    setApiKey("");
    setRemoveKey(false);
    if (apiKey.trim() || removeKey) {
      setAi(null);
      setAiError("");
    }
    revalidator.revalidate();
    return !!apiKey.trim() && !removeKey;
  }
  async function save() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const newKey = await persist();
      setNotice("Settings saved. New drafts will use these pricing defaults.");
      if (newKey) await discover();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  async function test() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("test");
    setError("");
    setNotice("");
    try {
      if (unsaved) await persist();
      const result = await api("testConnection");
      setNotice(
        `${result.message} Environment: ${result.environment}. Request ID: ${result.requestId || "not supplied"}.`,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  async function discover() {
    setAiError("");
    try {
      const result = await api("aiCredits");
      setAi({
        account: result.shopDomain,
        balance: result.creditsBalance,
        rules: (
          result.rules as {
            feature: keyof typeof aiFeatureLabel;
            credits: number;
            enabled: boolean;
          }[]
        )
          .map(
            (rule) =>
              `${aiFeatureLabel[rule.feature] || rule.feature}: ${rule.credits}${rule.enabled ? "" : " (disabled)"}`,
          )
          .join(" · "),
      });
      setSettings((current) => ({ ...current, aiAccount: result.shopDomain }));
    } catch (e) {
      setAi(null);
      setAiError(errorText(e));
    }
  }
  async function creditsCheck() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy("credits");
    setError("");
    try {
      if (unsaved) await persist();
      await discover();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy("");
      inFlight.current = false;
    }
  }
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your connections, defaults and publishing preferences."
        actions={
          <button
            className="primary"
            disabled={!!busy}
            onClick={() => void save()}
          >
            {busy === "save" ? "Saving…" : "Save"}
          </button>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="success">{notice}</Banner>}
      <fieldset disabled={!!busy}>
        <section className="settings-section">
          <div className="settings-intro">
            <h2>HIOBuy connection</h2>
            <p>
              Use your own HIOBuy Public API key and authorized 1688 channel.
            </p>
            <a
              href="https://hiobuy.com/en/api-docs/authentication"
              target="_blank"
              rel="noreferrer"
            >
              Authentication documentation ↗
            </a>
          </div>
          <div className="card settings-card">
            <div className="section-heading">
              <h3>API access</h3>
              <Badge tone={settings.keyConfigured ? "green" : ""}>
                {settings.keyConfigured
                  ? `${settings.environment} · key configured`
                  : "Not connected"}
              </Badge>
            </div>
            <label>
              HIOBuy API key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="new-password"
                placeholder={
                  settings.keyConfigured
                    ? "A key is stored securely. Enter a replacement to rotate."
                    : "hio_live_… or hio_test_…"
                }
              />
              <small>
                Stored encrypted on the server. The saved key is never returned
                to this page. Leave blank to keep it.
              </small>
            </label>
            {settings.keyConfigured && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={removeKey}
                  onChange={(e) => setRemoveKey(e.target.checked)}
                />
                Remove the stored API key when saving
              </label>
            )}
            <div className="row wrap">
              <button disabled={!keyReady} onClick={() => void test()}>
                {busy === "test"
                  ? "Testing connection…"
                  : unsaved
                    ? "Save and test connection"
                    : "Test connection"}
              </button>
              <span className="hint">
                A real 1688 search request; may consume API quota.
              </span>
            </div>
            <div className="muted-box">
              <strong>Sandbox and Production share the same API origin.</strong>
              <p>
                <code>hio_test_…</code> returns simulated data.{" "}
                <code>hio_live_…</code> uses your production subscription and
                channel access.
              </p>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-intro">
            <h2>Commerce AI</h2>
            <p>
              Optional. Only needed for AI translation and image tools. Search
              and import work without it.
            </p>
            <a
              href="https://hiobuy.com/zh/api-docs/commerce-ai"
              target="_blank"
              rel="noreferrer"
            >
              Commerce AI documentation ↗
            </a>
          </div>
          <div className="card settings-card">
            <div className="section-heading">
              <h3>Prepaid AI account</h3>
              <Badge tone={account ? "green" : ""}>
                {account ? "Linked" : "Not linked"}
              </Badge>
            </div>
            {account ? (
              <dl className="facts">
                <dt>AI account</dt>
                <dd>{account}</dd>
                {ai && (
                  <>
                    <dt>Balance</dt>
                    <dd>{ai.balance} AI Credits</dd>
                    <dt>Prices per task</dt>
                    <dd>{ai.rules || "No public prices were returned."}</dd>
                  </>
                )}
              </dl>
            ) : (
              <p className="hint">
                Found automatically from your HIOBuy API key. There is nothing
                to copy or paste.
              </p>
            )}
            {ai && ai.balance <= 0 && (
              <Banner tone="warning">
                Your balance is 0 AI Credits. Top up in HIOBuy Developer Center
                → AI Enhancement before running AI tools.
              </Banner>
            )}
            {aiError && <Banner tone="error">{aiError}</Banner>}
            <div className="row wrap">
              <button disabled={!keyReady} onClick={() => void creditsCheck()}>
                {busy === "credits"
                  ? "Checking…"
                  : unsaved
                    ? "Save and check AI account"
                    : account
                      ? "Refresh balance"
                      : "Find AI account"}
              </button>
              <span className="hint">
                Reads the account, balance and prices. It does not reserve
                Credits or call a model. AI Credits are separate from product
                API quota.
              </span>
            </div>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-intro">
            <h2>Pricing defaults</h2>
            <p>
              Set a starting point for new drafts. Each product can override
              these values.
            </p>
          </div>
          <div className="card settings-card">
            <div className="currency-line">
              <span>
                <strong>Store currency · {data.context.currency}</strong>
                <small>
                  {cnyStore
                    ? "From your Shopify store. Supplier prices are already in CNY, so no exchange rate is needed."
                    : "From your Shopify store. Imported prices always use this currency."}
                </small>
              </span>
              <Badge tone="green">Synced</Badge>
            </div>
            {!cnyStore && (
              <label>
                Exchange rate · 1 CNY = ? {settings.currency}
                <input
                  inputMode="decimal"
                  value={settings.exchangeRate}
                  onChange={(e) =>
                    setSettings({ ...settings, exchangeRate: e.target.value })
                  }
                />
                <small>
                  Set it manually. No exchange-rate service is used.
                </small>
              </label>
            )}
            <div className="two-col">
              <label>
                Default price multiplier
                <input
                  inputMode="decimal"
                  value={settings.multiplier}
                  onChange={(e) =>
                    setSettings({ ...settings, multiplier: e.target.value })
                  }
                />
              </label>
              <label>
                Price rounding
                <select
                  value={settings.rounding}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      rounding: e.target.value as typeof settings.rounding,
                    })
                  }
                >
                  <option value="two_decimals">Currency precision</option>
                  <option value="ending_99">Round up to .99</option>
                  <option value="whole">Round up to whole</option>
                </select>
              </label>
            </div>
            <div className="price-example">
              <span>Example</span>
              <strong>¥10.00 supplier cost</strong>
              <span>→</span>
              <strong>
                {example
                  ? `${example} ${settings.currency} selling price`
                  : "Check the values above"}
              </strong>
              <small>
                {cnyStore
                  ? "Cost × multiplier, then rounding."
                  : "Cost × exchange rate × multiplier, then rounding."}
              </small>
            </div>
            <label>
              Default Shopify product status
              <select
                value={settings.publishStatus}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    publishStatus: e.target
                      .value as typeof settings.publishStatus,
                  })
                }
              >
                <option value="DRAFT">Draft</option>
                <option value="ACTIVE">Active</option>
              </select>
            </label>
          </div>
        </section>
        <section className="settings-section">
          <div className="settings-intro">
            <h2>Shopify connection</h2>
            <p>
              Authentication and permissions are managed through your Shopify
              app installation.
            </p>
          </div>
          <div className="card settings-card">
            <div className="row between">
              <h3>{data.context.name}</h3>
              <Badge
                tone={data.context.missingScopes.length ? "amber" : "green"}
              >
                {data.context.missingScopes.length
                  ? "Permissions required"
                  : "Authorized"}
              </Badge>
            </div>
            <dl className="facts">
              <dt>Connected shop</dt>
              <dd>{data.context.domain}</dd>
              <dt>Admin API</dt>
              <dd>2026-10 · GraphQL</dd>
              <dt>Store currency</dt>
              <dd>{data.context.currency}</dd>
              <dt>Granted scopes</dt>
              <dd>{data.context.scopes.join(", ")}</dd>
            </dl>
            {data.context.missingScopes.length > 0 && (
              <Banner tone="warning">
                Update app scopes and reauthorize:{" "}
                {data.context.missingScopes.join(", ")}.
              </Banner>
            )}
            <p className="hint">
              Draft and Active are product statuses. Manage sales channel
              availability in Shopify Admin after import.
            </p>
          </div>
        </section>
      </fieldset>
      <div className="settings-actions">
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => void save()}
        >
          {busy === "save" ? "Saving…" : "Save settings"}
        </button>
      </div>
    </>
  );
}
