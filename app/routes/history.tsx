import { useEffect, useRef, useState } from "react";
import {
  Link,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
  type LoaderFunctionArgs,
} from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { api, errorText, publishWhenReady } from "../lib/client";
import { Badge, Banner, Empty, Modal } from "../components/ui";
import { PageHeader } from "../components/chrome";
export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const page = Math.max(
    1,
    Math.min(
      10000,
      Number.parseInt(url.searchParams.get("page") || "1", 10) || 1,
    ),
  );
  const [records, count, drafts] = await Promise.all([
    db.importRecord.findMany({
      where: { shop: session.shop },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 20,
      take: 20,
      select: {
        id: true,
        draftId: true,
        sourceId: true,
        sourceUrl: true,
        sourcePlatform: true,
        title: true,
        status: true,
        publishStatus: true,
        productId: true,
        error: true,
        warnings: true,
        attempts: true,
        createdAt: true,
        updatedAt: true,
        lockedAt: true,
        draft: { select: { environment: true } },
      },
    }),
    db.importRecord.count({ where: { shop: session.shop } }),
    db.draft.findMany({
      where: { shop: session.shop, imports: { none: {} } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: {
        id: true,
        sourceId: true,
        editorJson: true,
        updatedAt: true,
        environment: true,
      },
    }),
  ]);
  return {
    records: records.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      canRetry:
        r.status === "FAILED" ||
        r.status === "NEEDS_RETRY" ||
        r.status === "PENDING" ||
        (r.status === "RUNNING" &&
          !!r.lockedAt &&
          r.lockedAt.getTime() < Date.now() - 600000),
    })),
    drafts: drafts.map((d) => ({
      id: d.id,
      title: JSON.parse(d.editorJson).title as string,
      environment: d.environment,
      updatedAt: d.updatedAt.toISOString(),
    })),
    count,
    page,
    shop: session.shop,
  };
}
function productUrl(shop: string, id: string) {
  return `https://${shop}/admin/products/${id.split("/").pop()}`;
}
const statusText: Record<string, string> = {
  SUCCEEDED: "Imported",
  FAILED: "Failed",
  NEEDS_RETRY: "Finishing",
  RUNNING: "Importing",
  PENDING: "Waiting",
};
function statusTone(status: string) {
  if (status === "SUCCEEDED") return "green";
  if (status === "FAILED") return "danger";
  return "amber";
}
export default function History() {
  const data = useLoaderData<typeof loader>();
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const [params, setParams] = useSearchParams();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [detail, setDetail] = useState<(typeof data.records)[number] | null>(
    null,
  );
  const running = data.records.some((r) => r.status === "RUNNING");
  const active = useRef(false);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        revalidator.state === "idle"
      )
        revalidator.revalidate();
    }, 4000);
    return () => clearInterval(timer);
  }, [running, revalidator]);
  async function retry(draftId: string) {
    if (active.current) return;
    active.current = true;
    setBusy(draftId);
    setError("");
    try {
      await publishWhenReady(draftId, undefined, () => revalidator.revalidate());
    } catch (e) {
      setError(errorText(e));
    } finally {
      active.current = false;
      setBusy("");
      revalidator.revalidate();
    }
  }
  async function edit(draftId: string) {
    if (active.current) return;
    active.current = true;
    setBusy(draftId);
    try {
      const result = await api("duplicateDraft", { draftId });
      navigate(`/app/editor/${result.id}`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      active.current = false;
      setBusy("");
    }
  }
  return (
    <>
      <PageHeader
        title="Import history"
        subtitle="Every import, its destination and its next step."
        actions={
          <Link className="button primary" to="/app">
            Find products
          </Link>
        }
      />
      {error && <Banner tone="error">{error}</Banner>}
      {busy && (
        <Banner>
          Import in progress. Uploading or processing images can take a moment;
          duplicate requests are blocked.
        </Banner>
      )}
      {data.drafts.length > 0 && (
        <section className="card drafts-card">
          <div className="section-heading">
            <h2>Continue editing</h2>
            <span className="muted">{data.drafts.length} recent drafts</span>
          </div>
          <div className="draft-grid">
            {data.drafts.map((d) => (
              <Link
                key={d.id}
                className="draft-link"
                to={`/app/editor/${d.id}`}
              >
                <span className="draft-icon">▧</span>
                <span>
                  <strong>{d.title}</strong>
                  <small>
                    {d.environment === "sandbox" ? "Sandbox · " : ""}Saved{" "}
                    {new Date(d.updatedAt).toLocaleString()}
                  </small>
                </span>
                <span>→</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      <section className="card history-card">
        <div className="section-heading">
          <h2>Imports</h2>
          <Badge>{data.count} total</Badge>
        </div>
        {data.records.length ? (
          <div className="import-list">
            {data.records.map((r) => (
              <div className="import-row" key={r.id}>
                <button className="import-main" onClick={() => setDetail(r)}>
                  <strong>{r.title}</strong>
                  <small>
                    {new Date(r.createdAt).toLocaleString()} · 1688{" "}
                    {r.sourceId}
                    {r.draft.environment === "sandbox" ? " · Sandbox" : ""} ·{" "}
                    {r.attempts} {r.attempts === 1 ? "attempt" : "attempts"}
                  </small>
                  {r.status === "FAILED" && r.error && (
                    <small className="import-error">{r.error}</small>
                  )}
                </button>
                <Badge tone={statusTone(r.status)}>
                  {statusText[r.status] || r.status}
                </Badge>
                <div className="import-actions">
                  {r.productId ? (
                    <a
                      className="button"
                      href={productUrl(data.shop, r.productId)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open in Shopify
                    </a>
                  ) : r.canRetry ? (
                    <button
                      className="primary"
                      disabled={!!busy}
                      onClick={() => void retry(r.draftId)}
                    >
                      {busy === r.draftId ? "Finishing…" : "Finish import"}
                    </button>
                  ) : (
                    <Link className="button" to={`/app/editor/${r.draftId}`}>
                      View
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="Your imports will appear here">
            Search for a product, save your edits and import it to Shopify.
          </Empty>
        )}
      </section>
      {data.count > 20 && (
        <div className="pagination">
          <button
            disabled={data.page <= 1}
            onClick={() =>
              setParams({
                ...Object.fromEntries(params),
                page: String(data.page - 1),
              })
            }
          >
            ← Previous
          </button>
          <span>Page {data.page}</span>
          <button
            disabled={data.page * 20 >= data.count}
            onClick={() =>
              setParams({
                ...Object.fromEntries(params),
                page: String(data.page + 1),
              })
            }
          >
            Next →
          </button>
        </div>
      )}
      {detail && (
        <Modal
          title="Import details"
          onClose={() => setDetail(null)}
          footer={
            <>
              {detail.productId && (
                <a
                  className="button"
                  href={productUrl(data.shop, detail.productId)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open in Shopify
                </a>
              )}
              {detail.canRetry && (
                <button
                  className="primary"
                  disabled={!!busy}
                  onClick={() => {
                    setDetail(null);
                    void retry(detail.draftId);
                  }}
                >
                  Finish import
                </button>
              )}
              <button
                disabled={!!busy || detail.status === "RUNNING"}
                onClick={() => void edit(detail.draftId)}
              >
                Re-edit as new draft
              </button>
            </>
          }
        >
          <h2>{detail.title}</h2>
          <dl className="facts">
            <dt>Source platform</dt>
            <dd>{detail.sourcePlatform}</dd>
            <dt>Source ID</dt>
            <dd>{detail.sourceId}</dd>
            <dt>Source URL</dt>
            <dd>
              {detail.sourceUrl ? (
                <a target="_blank" rel="noreferrer" href={detail.sourceUrl}>
                  View on 1688 ↗
                </a>
              ) : (
                "Not supplied"
              )}
            </dd>
            <dt>Imported</dt>
            <dd>{new Date(detail.createdAt).toLocaleString()}</dd>
            <dt>Last update</dt>
            <dd>{new Date(detail.updatedAt).toLocaleString()}</dd>
            <dt>Status</dt>
            <dd>{statusText[detail.status] || detail.status}</dd>
            <dt>Shopify status</dt>
            <dd>{detail.publishStatus}</dd>
            <dt>Product ID</dt>
            <dd>{detail.productId || "Awaiting confirmation"}</dd>
            <dt>Retry attempts</dt>
            <dd>{detail.attempts}</dd>
          </dl>
          {detail.error && <Banner tone="error">{detail.error}</Banner>}
          {detail.warnings && <Banner tone="warning">{detail.warnings}</Banner>}
          <p className="hint">
            Safe retry uses the saved import snapshot and product handle.
            Re-edit opens a new draft; importing it creates a separate product.
          </p>
        </Modal>
      )}
    </>
  );
}
